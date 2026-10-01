import { enqueueJob, knowledge, resolveAppRole } from 'deepspace/worker'
import { knowledgeFolderFor } from '../crawl/pages'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { CHECK_JOB_TYPE, CHECK_LIMITS } from '../check/job-types'
import { REVIEW_DECISIONS, VERDICTS, type Check, type Claim, type Review, type ReviewDecision, type Verdict } from '../schemas/checks-schema'
import type { Source } from '../schemas/sources-schema'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Start a claim check. This is the only way checks get created: the job
 * spends the owner's AI credits, so the action validates the input, enforces
 * per-user and app-wide daily limits, then enqueues the job server-side
 * (members cannot enqueue on the job socket — see AppJobRoom in worker.ts).
 */
const startCheck: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const text = typeof params.text === 'string' ? params.text.trim() : ''
  const sourceId = typeof params.sourceId === 'string' ? params.sourceId : ''
  const title = typeof params.title === 'string' ? params.title.trim().slice(0, 120) : ''

  if (text.length < CHECK_LIMITS.minChars || text.length > CHECK_LIMITS.maxChars) {
    return { success: false, error: `Paste between ${CHECK_LIMITS.minChars} and ${CHECK_LIMITS.maxChars} characters.` }
  }

  const source = await tools.get<Record<string, unknown>>('sources', sourceId)
  const sourceData = source.success ? (source.data.record.data as unknown as Source) : undefined
  if (!sourceData || sourceData.status !== 'ready') {
    return { success: false, error: 'Pick a docs source that has finished crawling.' }
  }

  const role = await resolveAppRole(env, userId)
  if (role !== 'member' && role !== 'admin') return { success: false, error: 'Only members can run checks.' }

  // Rolling 24h limits, counted from the checks collection itself. `tools`
  // bypasses RBAC, so this sees everyone's checks for the app-wide cap.
  const recent = await tools.query('checks', { orderBy: 'createdAt', orderDir: 'desc', limit: 200 })
  if (!recent.success) return { success: false, error: 'Could not check usage limits. Try again.' }
  const since = Date.now() - DAY_MS
  const today = recent.data.records.filter((r) => Date.parse(r.createdAt) > since)
  const mine = today.filter((r) => r.createdBy === userId).length
  const perUser = role === 'admin' ? CHECK_LIMITS.adminPerDay : CHECK_LIMITS.memberPerDay
  if (mine >= perUser) {
    return { success: false, error: `You've run ${mine} checks in the last 24 hours (limit ${perUser}). Try again later.` }
  }
  if (today.length >= CHECK_LIMITS.appPerDay) {
    return { success: false, error: 'ClaimCheck has hit its daily check budget. Try again tomorrow.' }
  }

  const created = await tools.create<Record<string, unknown>>('checks', {
    title: title || `${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
    text,
    sourceId,
    status: 'queued',
    statusMessage: 'Waiting to start',
  } satisfies Check)
  if (!created.success) return { success: false, error: created.error ?? 'Could not create the check.' }

  const checkId = created.data.recordId
  await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, CHECK_JOB_TYPE, { checkId }, { enqueuedBy: userId })
  return { success: true, data: { checkId } }
}

/**
 * Record a teammate's review of one claim's verdict. The person who ran the
 * check cannot review it — that is the point of a second pair of eyes — and
 * a disagreement must name the verdict the reviewer would give instead.
 * Re-reviewing updates the reviewer's existing row (the room's `uniqueOn`
 * keeps it to one per reviewer per claim).
 */
const reviewClaim: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const claimId = typeof params.claimId === 'string' ? params.claimId : ''
  const decision = params.decision as ReviewDecision
  const verdict = params.verdict as Verdict | undefined
  const note = typeof params.note === 'string' ? params.note.trim().slice(0, 500) : ''

  if (!REVIEW_DECISIONS.includes(decision)) return { success: false, error: 'Choose agree or disagree.' }
  const role = await resolveAppRole(env, userId)
  if (role !== 'member' && role !== 'admin') return { success: false, error: 'Only members can review.' }

  const claim = await tools.get<Record<string, unknown>>('claims', claimId)
  if (!claim.success) return { success: false, error: 'Claim not found.' }
  const claimData = claim.data.record.data as unknown as Claim
  if (!claimData.verdict) return { success: false, error: 'This claim has not been checked yet.' }

  const check = await tools.get<Record<string, unknown>>('checks', claimData.checkId)
  if (!check.success) return { success: false, error: 'Check not found.' }
  if (check.data.record.createdBy === userId) {
    return { success: false, error: 'You ran this check, so a teammate has to review it.' }
  }

  if (decision === 'disagree' && (!verdict || !VERDICTS.includes(verdict) || verdict === claimData.verdict)) {
    return { success: false, error: 'Pick the verdict you would give instead.' }
  }

  const review: Review = {
    checkId: claimData.checkId,
    claimId,
    reviewerId: userId,
    decision,
    ...(decision === 'disagree' ? { verdict } : {}),
    note,
  }
  const existing = await tools.query('reviews', { where: { claimId, reviewerId: userId }, limit: 1 })
  const prior = existing.success ? existing.data.records[0] : undefined
  const saved = prior
    ? await tools.update('reviews', prior.recordId, { decision, verdict: review.verdict ?? null, note })
    : await tools.create<Record<string, unknown>>('reviews', review as unknown as Record<string, unknown>)
  if (!saved.success) return { success: false, error: saved.error ?? 'Could not save the review.' }
  return { success: true, data: { reviewId: saved.data.recordId } }
}

/**
 * Return the check's discussion channel, creating it the first time anyone
 * opens the check. Channels use the bundled public messaging schemas; the
 * check row (members cannot update it) remembers which channel is its own.
 */
const openDiscussion: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const checkId = typeof params.checkId === 'string' ? params.checkId : ''
  const check = await tools.get<Record<string, unknown>>('checks', checkId)
  if (!check.success) return { success: false, error: 'Check not found.' }
  const existing = (check.data.record.data as unknown as Check).channelId
  if (existing) return { success: true, data: { channelId: existing } }

  // A fixed record id makes this idempotent: if two people open the check at
  // once, the second create fails and both end up on the same channel.
  const channelId = `check-${checkId}`
  const created = await tools.create(
    'channels',
    {
      name: channelId,
      description: String((check.data.record.data as unknown as Check).title ?? 'Claim check'),
      createdBy: userId,
    },
    channelId,
  )
  if (!created.success && !(await tools.get('channels', channelId)).success) {
    return { success: false, error: created.error ?? 'Could not open the discussion.' }
  }
  await tools.update('checks', checkId, { channelId })
  return { success: true, data: { channelId } }
}

/**
 * Local dev/test only: create a finished check with pre-written verdicts, so
 * the multi-user review spec exercises reviews, presence and discussion
 * without paying for model calls on every run. `ALLOW_DEBUG_ROUTES` is set
 * by `deepspace dev start` / `deepspace test run` and never in production.
 */
const seedDemoCheck: ActionHandler<Env> = async ({ params, tools, env }) => {
  if (env.ALLOW_DEBUG_ROUTES !== 'true') return { success: false, error: 'Not available.' }
  const title = typeof params.title === 'string' ? params.title : '__test__ seeded check'
  const text = 'DeepSpace deploys your app to Cloudflare Workers. DeepSpace is SOC 2 Type II certified.'
  const created = await tools.create('checks', {
    title,
    text,
    sourceId: 'seed',
    status: 'done',
    statusMessage: '2 claims checked',
    claimCount: 2,
  } satisfies Check)
  if (!created.success) return { success: false, error: created.error }
  const checkId = created.data.recordId
  const claims: Claim[] = [
    {
      checkId,
      index: 0,
      text: 'DeepSpace deploys your app to Cloudflare Workers.',
      span: 'DeepSpace deploys your app to Cloudflare Workers.',
      verdict: 'supported',
      explanation: 'Seeded verdict.',
      citations: [{ url: 'https://docs.deep.space/concepts/architecture', title: 'Architecture', quote: 'A DeepSpace app is a normal Cloudflare Worker.' }],
      rejectedQuotes: 0,
      // `stale: true` lets the spec exercise the weekly re-check's UI without
      // waiting for real docs to change.
      ...(params.stale === true
        ? {
            stale: {
              detectedAt: new Date().toISOString(),
              missing: [{ url: 'https://docs.deep.space/concepts/architecture', title: 'Architecture', quote: 'A DeepSpace app is a normal Cloudflare Worker.' }],
            },
          }
        : {}),
    },
    {
      checkId,
      index: 1,
      text: 'DeepSpace is SOC 2 Type II certified.',
      span: 'DeepSpace is SOC 2 Type II certified.',
      verdict: 'not_in_docs',
      explanation: 'Seeded verdict.',
      citations: [],
      rejectedQuotes: 0,
    },
  ]
  const claimIds: string[] = []
  for (const claim of claims) {
    const row = await tools.create('claims', claim as unknown as Record<string, unknown>)
    if (!row.success) return { success: false, error: row.error }
    claimIds.push(row.data.recordId)
  }
  return { success: true, data: { checkId, claimIds } }
}

/**
 * Admin diagnostic: what the docs search returns for a query, and whether
 * each chunk maps back to a crawled page. Used to tell retrieval misses
 * (nothing found / unmapped chunks) apart from model judgment errors.
 * One hybrid search per call (~$0.00075).
 */
const inspectSearch: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if ((await resolveAppRole(env, userId)) !== 'admin') return { success: false, error: 'Admins only.' }
  const sourceId = typeof params.sourceId === 'string' ? params.sourceId : ''
  const query = typeof params.query === 'string' ? params.query.slice(0, 500) : ''
  const pages = await tools.query('doc_pages', { where: { sourceId }, limit: 500 })
  const keys = new Map(
    (pages.success ? pages.data.records : []).map((p) => [String(p.data.pageKey), String(p.data.url)]),
  )
  const matchThreshold = typeof params.matchThreshold === 'number' ? params.matchThreshold : undefined
  const { chunks } = await knowledge(env).search(query, {
    folder: knowledgeFolderFor(sourceId),
    mode: 'hybrid',
    limit: 8,
    ...(matchThreshold !== undefined ? { matchThreshold } : {}),
  })
  return {
    success: true,
    data: {
      pagesKnown: keys.size,
      chunks: chunks.map((c) => {
        const file = (c.filename ?? c.key ?? '').split('/').pop() ?? ''
        return {
          score: c.score,
          filename: c.filename,
          key: c.key,
          mappedTo: keys.get(file.replace(/\.md$/, '')) ?? null,
          chars: c.text.length,
          text: c.text.slice(0, 160),
        }
      }),
    },
  }
}

export const actions: Record<string, ActionHandler<Env>> = {
  startCheck,
  reviewClaim,
  openDiscussion,
  seedDemoCheck,
  inspectSearch,
}
