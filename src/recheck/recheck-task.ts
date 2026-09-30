/**
 * `recheck-citations` cron task — re-fetch every cited docs page (capped) and
 * flag claims whose supporting quotes are no longer there. See staleness.ts
 * for the rule; this file is the I/O around it.
 *
 * Cost is bounded by MAX_PAGES_PER_RECHECK single-page scrapes and no model
 * calls; each run is logged to the `rechecks` collection with its cost.
 */

import { buildCronContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Citation, Claim, Recheck } from '../schemas/checks-schema'
import { computeStaleUpdates, pagesToFetch, type CitedClaim } from './staleness'

type Row<T> = { recordId: string; data: T }

export async function runRecheck(env: Env): Promise<Recheck> {
  const owner = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const startedAt = new Date().toISOString()

  const cited: CitedClaim[] = []
  for (const verdict of ['supported', 'contradicted'] as const) {
    const rows = (await owner.records.query('claims', { where: { verdict }, limit: 1000 })) as Row<Claim>[]
    for (const row of rows) {
      const citations = (row.data.citations ?? []) as Citation[]
      if (citations.length) cited.push({ claimId: row.recordId, citations, stale: row.data.stale })
    }
  }

  const urls = pagesToFetch(cited)
  const pageText = new Map<string, string | null>()
  let costUsd = 0
  for (const url of urls) {
    try {
      const res = (await owner.integrations.call('firecrawl/scrape', {
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      })) as { data?: { markdown?: string }; costUsd?: number }
      costUsd += res.costUsd ?? 0
      const markdown = res.data?.markdown
      pageText.set(url, typeof markdown === 'string' && markdown.trim() ? markdown : null)
    } catch (err) {
      console.warn(`[recheck] could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`)
      pageText.set(url, null)
    }
  }

  // Only claims whose pages were in this run's fetch set are judged.
  const inScope = cited.filter((c) => c.citations.some((cite) => pageText.has(cite.url)))
  const updates = computeStaleUpdates(inScope, pageText, startedAt)
  for (const u of updates) {
    await owner.records.update('claims', u.claimId, { stale: u.stale })
  }

  const summary: Recheck = {
    startedAt,
    finishedAt: new Date().toISOString(),
    pagesFetched: urls.length,
    pagesFailed: [...pageText.values()].filter((t) => t === null).length,
    claimsChecked: inScope.length,
    newlyStale: updates.filter((u) => u.stale).length,
    cleared: updates.filter((u) => !u.stale).length,
    costUsd,
  }
  await owner.records.create('rechecks', summary as unknown as Record<string, unknown>)
  console.info(`[recheck] ${JSON.stringify(summary)}`)
  return summary
}
