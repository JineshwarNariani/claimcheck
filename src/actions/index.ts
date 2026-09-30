import { enqueueJob, resolveAppRole } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { CHECK_JOB_TYPE, CHECK_LIMITS } from '../check/job-types'
import type { Check } from '../schemas/checks-schema'
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

export const actions: Record<string, ActionHandler<Env>> = { startCheck }
