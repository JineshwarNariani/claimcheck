/**
 * `check-claims` job — split a check's text into claims, then give each claim
 * a grounded verdict against the docs source.
 *
 *   extract ──Haiku──▶ claims rows ──▶ verify one claim per tick:
 *     knowledge search → Sonnet verdict → word-for-word quote check → save
 *
 * Each claim is its own `ctx.continue` tick. A retry after a restart skips
 * claims that already have a verdict, so it never pays twice for the same
 * model call, and progress shows up claim by claim in the UI.
 */

import { generateText, Output } from 'ai'
import { buildCronContext, createDeepSpaceAI, knowledge } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { knowledgeFolderFor } from '../crawl/pages'
import type { Check, Claim } from '../schemas/checks-schema'
import type { DocPage } from '../schemas/sources-schema'
import { dedupeEvidence, groundVerdict, type Evidence } from './grounding'
import type { CheckPayload } from './job-types'
import {
  EXTRACT_MODEL,
  EXTRACT_SYSTEM,
  PRICE_PER_MTOK,
  SEARCH_PRICE_USD,
  VERDICT_MODEL,
  VERDICT_SYSTEM,
  extractSchema,
  verdictPrompt,
  verdictSchema,
} from './prompts'

type Usage = NonNullable<Check['usage']>
type CheckState = { phase: 'verify'; usage: Usage }

const SEARCH_HITS = 8
const EVIDENCE_PER_CLAIM = 5
const MAX_PASSAGE_CHARS = 2500
const MODEL_TIMEOUT_MS = 90_000

type Row<T> = { recordId: string; data: T }

export async function runCheckJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  const { checkId } = job.payload as CheckPayload
  if (!checkId) throw new Error('check-claims needs { checkId }')
  const owner = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const setCheck = (patch: Partial<Check>) => owner.records.update('checks', checkId, patch)
  const ai = createDeepSpaceAI(env, 'anthropic') // no authToken → billed to the app owner
  const state = job.resumeFrom as CheckState | undefined

  try {
    const [check] = (await owner.records.query('checks', { where: { recordId: checkId }, limit: 1 })) as Row<Check>[]
    if (!check) throw new Error(`Check ${checkId} not found`)

    if (!state) {
      await setCheck({ status: 'extracting', statusMessage: 'Finding claims' })
      ctx.progress(0.05, 'Finding claims')
      const { output, usage } = await generateText({
        model: ai(EXTRACT_MODEL),
        system: EXTRACT_SYSTEM,
        prompt: `<text>\n${check.data.text}\n</text>`,
        output: Output.object({ schema: extractSchema }),
        maxOutputTokens: 4000,
        abortSignal: AbortSignal.any([ctx.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
      })
      const claims = output.claims.filter((c) => c.claim.trim())
      if (claims.length === 0) throw new Error('No checkable claims found in this text')

      // A retry of this phase replaces whatever a previous attempt wrote.
      await deleteClaims(owner, checkId)
      for (const [index, c] of claims.entries()) {
        await owner.records.create('claims', {
          checkId,
          index,
          text: c.claim.trim(),
          // Only keep a span we can actually find, so the UI can highlight it.
          span: check.data.text.includes(c.span) ? c.span : undefined,
        } satisfies Claim)
      }
      const u = addModelUsage(emptyUsage(), EXTRACT_MODEL, usage)
      await setCheck({ status: 'verifying', claimCount: claims.length, statusMessage: `Checking 0/${claims.length} claims`, usage: u })
      ctx.continue({ phase: 'verify', usage: u } satisfies CheckState, { afterMs: 100 })
      return
    }

    const claims = ((await owner.records.query('claims', { where: { checkId }, limit: 100 })) as Row<Claim>[]).sort(
      (a, b) => a.data.index - b.data.index,
    )
    const next = claims.find((c) => !c.data.verdict)
    const done = claims.length - claims.filter((c) => !c.data.verdict).length

    if (!next) {
      await setCheck({ status: 'done', statusMessage: `${claims.length} claims checked`, usage: state.usage })
      return { claims: claims.length, usage: state.usage }
    }

    ctx.progress(0.1 + 0.9 * (done / claims.length), `Checking claim ${done + 1}/${claims.length}`)
    const evidence = await findEvidence(env, owner, check.data.sourceId, next.data.text)
    const { output, usage } = await generateText({
      model: ai(VERDICT_MODEL),
      system: VERDICT_SYSTEM,
      prompt: verdictPrompt(next.data.text, evidence),
      output: Output.object({ schema: verdictSchema }),
      providerOptions: { anthropic: { effort: 'low' } },
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.any([ctx.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
    })
    const grounded = groundVerdict(output, evidence)
    await owner.records.update('claims', next.recordId, {
      verdict: grounded.verdict,
      explanation: grounded.explanation,
      citations: grounded.citations,
      rejectedQuotes: grounded.rejectedQuotes,
    } satisfies Partial<Claim>)

    const u = addModelUsage({ ...state.usage, searches: state.usage.searches + 1 }, VERDICT_MODEL, usage)
    u.estimatedUsd += SEARCH_PRICE_USD
    await setCheck({ statusMessage: `Checking ${done + 1}/${claims.length} claims`, usage: u })
    ctx.continue({ phase: 'verify', usage: u } satisfies CheckState, { afterMs: 100 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setCheck({ status: 'failed', statusMessage: message }).catch(() => {})
    throw err
  }
}

type OwnerContext = ReturnType<typeof buildCronContext>

async function deleteClaims(owner: OwnerContext, checkId: string): Promise<void> {
  const rows = (await owner.records.query('claims', { where: { checkId }, limit: 100 })) as Row<Claim>[]
  for (const row of rows) await owner.records.delete('claims', row.recordId)
}

/**
 * Search the source's knowledge folder and turn chunks into evidence with the
 * page's canonical URL and title (chunks are keyed by `<pageKey>.md`).
 */
async function findEvidence(env: Env, owner: OwnerContext, sourceId: string, claim: string): Promise<Evidence[]> {
  const pages = (await owner.records.query('doc_pages', { where: { sourceId }, limit: 500 })) as Row<DocPage>[]
  const byKey = new Map(pages.map((p) => [p.data.pageKey, p.data]))
  const { chunks } = await knowledge(env).search(claim, {
    folder: knowledgeFolderFor(sourceId),
    mode: 'hybrid',
    limit: SEARCH_HITS,
  })
  const hits: Evidence[] = []
  for (const chunk of chunks) {
    const file = (chunk.filename ?? chunk.key ?? '').split('/').pop() ?? ''
    const page = byKey.get(file.replace(/\.md$/, ''))
    if (!page) continue // chunk from a page that was re-crawled away
    hits.push({ url: page.url, title: page.title, text: chunk.text.slice(0, MAX_PASSAGE_CHARS) })
  }
  return dedupeEvidence(hits, EVIDENCE_PER_CLAIM)
}

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, searches: 0, estimatedUsd: 0 }
}

function addModelUsage(
  base: Usage,
  model: string,
  usage: { inputTokens?: number; outputTokens?: number },
): Usage {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const [inPrice, outPrice] = PRICE_PER_MTOK[model] ?? [0, 0]
  return {
    ...base,
    inputTokens: base.inputTokens + input,
    outputTokens: base.outputTokens + output,
    estimatedUsd: base.estimatedUsd + (input * inPrice + output * outPrice) / 1_000_000,
  }
}
