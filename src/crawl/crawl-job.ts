/**
 * `crawl-source` job — crawl one docs site with Firecrawl and index every page
 * into the app's managed knowledge base.
 *
 * Firecrawl crawls are asynchronous, so the job is a small state machine that
 * checkpoints with `ctx.continue(state)` between polls instead of sleeping in
 * one long handler:
 *
 *   (start) ──firecrawl/crawl──▶ poll ──get-crawl until done──▶ index ──kb.list until indexed──▶ ready
 *
 * Checkpointing matters for money as much as for time limits: if the worker
 * restarts mid-crawl, the retry resumes polling the SAME Firecrawl job from
 * `job.resumeFrom` instead of paying for a second crawl.
 */

import { buildCronContext, knowledge } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Source } from '../schemas/sources-schema'
import type { CrawlPayload } from './job-types'
import {
  clampPageLimit,
  extractPages,
  knowledgeFolderFor,
  normalizeSourceUrl,
  pageKeyFor,
  sha256Hex,
  type CrawledPage,
} from './pages'

type CrawlState =
  | { phase: 'poll'; firecrawlJobId: string; startedAt: number }
  | { phase: 'index'; startedAt: number; pageCount: number; costUsd: number; note?: string }

const POLL_MS = 5_000
const INDEX_POLL_MS = 10_000
const CRAWL_DEADLINE_MS = 10 * 60_000
const INDEX_DEADLINE_MS = 5 * 60_000

interface GetCrawlResult {
  status: string
  completed?: number | null
  total?: number | null
  costUsd?: number
  data?: unknown
  next?: string | null
}

export async function runCrawlJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  const payload = job.payload as CrawlPayload
  if (!payload?.sourceId || typeof payload.url !== 'string') {
    throw new Error('crawl-source needs { sourceId, url }')
  }
  const url = normalizeSourceUrl(payload.url)
  const records = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const setSource = (patch: Partial<Source>) => records.records.update('sources', payload.sourceId, patch)
  const state = job.resumeFrom as CrawlState | undefined

  try {
    if (!state) {
      const started = (await records.integrations.call('firecrawl/crawl', {
        url,
        limit: clampPageLimit(payload.pageLimit),
        ...(payload.includePaths?.length ? { includePaths: payload.includePaths } : {}),
        formats: ['markdown'],
        onlyMainContent: true,
      })) as { jobId: string }
      await setSource({ status: 'crawling', statusMessage: 'Crawl started' })
      ctx.progress(0.05, 'Crawl started')
      ctx.continue({ phase: 'poll', firecrawlJobId: started.jobId, startedAt: Date.now() }, { afterMs: POLL_MS })
      return
    }

    if (state.phase === 'poll') {
      if (Date.now() - state.startedAt > CRAWL_DEADLINE_MS) {
        throw new Error('Crawl did not finish within 10 minutes')
      }
      const crawl = (await records.integrations.call('firecrawl/get-crawl', {
        jobId: state.firecrawlJobId,
      })) as GetCrawlResult

      if (crawl.status === 'failed' || crawl.status === 'cancelled') {
        throw new Error(`Firecrawl reported the crawl ${crawl.status}`)
      }
      if (crawl.status !== 'completed') {
        const done = crawl.completed ?? 0
        const total = crawl.total ?? 0
        const message = total ? `Crawling ${done}/${total} pages` : 'Crawling'
        ctx.progress(0.05 + 0.55 * (total ? done / total : 0), message)
        await setSource({ statusMessage: message })
        ctx.continue(state, { afterMs: POLL_MS })
        return
      }

      const pages = extractPages(crawl.data)
      if (pages.length === 0) throw new Error('Crawl finished but returned no readable pages')
      // get-crawl pages its result past ~10 MB; a capped docs crawl stays far below,
      // so a `next` cursor means something unexpected — record it, don't hide it.
      const note = crawl.next ? 'Firecrawl returned a partial page list; some pages were skipped' : undefined

      await setSource({ status: 'indexing', statusMessage: `Indexing ${pages.length} pages`, pageCount: pages.length })
      await replacePages(env, records, payload.sourceId, pages, ctx)
      ctx.continue(
        { phase: 'index', startedAt: Date.now(), pageCount: pages.length, costUsd: crawl.costUsd ?? 0, note },
        { afterMs: INDEX_POLL_MS },
      )
      return
    }

    // phase === 'index': wait until the knowledge base has finished indexing.
    const items = await listKnowledgeItems(env, knowledgeFolderFor(payload.sourceId))
    const pending = items.filter((i) => i.status === 'queued' || i.status === 'running').length
    const errored = items.filter((i) => i.status === 'error').length
    const timedOut = Date.now() - state.startedAt > INDEX_DEADLINE_MS

    if (pending > 0 && !timedOut) {
      ctx.progress(0.9, `Indexing — ${pending} pages still queued`)
      ctx.continue(state, { afterMs: INDEX_POLL_MS })
      return
    }

    const notes = [
      state.note,
      errored ? `${errored} pages failed to index` : undefined,
      pending ? `${pending} pages were still indexing after 5 minutes` : undefined,
    ].filter(Boolean)
    await setSource({
      status: 'ready',
      statusMessage: notes.length ? notes.join('; ') : `${state.pageCount} pages indexed`,
      lastCrawledAt: new Date().toISOString(),
      costUsd: state.costUsd,
    })
    return { pageCount: state.pageCount, costUsd: state.costUsd, errored, pending }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setSource({ status: 'failed', statusMessage: message }).catch(() => {})
    throw err
  }
}

type OwnerContext = ReturnType<typeof buildCronContext>

/** `kb.list` returns at most 50 items per page; a source can have more. */
async function listKnowledgeItems(env: Env, folder: string) {
  const kb = knowledge(env)
  const items = []
  for (let page = 1; page <= 10; page++) {
    const listed = await kb.list({ folder, page, perPage: 50 })
    items.push(...listed.items)
    if (listed.items.length < 50 || (listed.totalPages != null && page >= listed.totalPages)) break
  }
  return items
}

/**
 * Swap a source's pages for a fresh crawl: drop the previous rows and their
 * knowledge items, then write and index the new ones. Runs after the crawl
 * succeeded, so a failed crawl never wipes a working index.
 */
async function replacePages(
  env: Env,
  owner: OwnerContext,
  sourceId: string,
  pages: CrawledPage[],
  ctx: JobContext,
): Promise<void> {
  const kb = knowledge(env)
  const previous = (await owner.records.query('doc_pages', { where: { sourceId }, limit: 500 })) as Array<{
    recordId: string
    data: { knowledgeItemIds?: string[] }
  }>
  for (const row of previous) {
    for (const itemId of row.data.knowledgeItemIds ?? []) {
      await kb.remove(itemId).catch(() => {}) // already gone is fine
    }
    await owner.records.delete('doc_pages', row.recordId)
  }

  const folder = knowledgeFolderFor(sourceId)
  const crawledAt = new Date().toISOString()
  for (const [i, page] of pages.entries()) {
    if (ctx.signal.aborted) throw new Error('Canceled')
    const pageKey = await pageKeyFor(page.url)
    const added = await kb.add(new File([page.markdown], `${pageKey}.md`, { type: 'text/markdown' }), { folder })
    await owner.records.create('doc_pages', {
      sourceId,
      url: page.url,
      title: page.title,
      pageKey,
      contentHash: await sha256Hex(page.markdown),
      chars: page.markdown.length,
      knowledgeItemIds: added.items.map((item) => item.id),
      crawledAt,
    })
    ctx.progress(0.6 + 0.3 * ((i + 1) / pages.length), `Indexed ${i + 1}/${pages.length} pages`)
  }
}
