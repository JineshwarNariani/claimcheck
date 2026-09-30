/**
 * Stale-claim detection — pure logic, unit-tested in staleness.test.ts.
 *
 * A verdict of supported/contradicted rests on quotes that appeared word for
 * word in the docs when the check ran. The weekly re-check re-fetches only the
 * cited pages and re-runs that same quote test. If a quote has disappeared,
 * the claim's evidence is gone and it is flagged stale; if the quote is back,
 * the flag clears. No model calls: the question "is this sentence still on
 * the page?" is answered by code.
 */

import { quoteAppearsIn } from '../check/grounding'
import type { Citation, StaleInfo } from '../schemas/checks-schema'

export const MAX_PAGES_PER_RECHECK = 30

export interface CitedClaim {
  claimId: string
  citations: Citation[]
  stale?: StaleInfo | null
}

/** Unique cited URLs, most-cited first, capped so one run has a bounded cost. */
export function pagesToFetch(claims: CitedClaim[], max = MAX_PAGES_PER_RECHECK): string[] {
  const counts = new Map<string, number>()
  for (const c of claims) for (const cite of c.citations) counts.set(cite.url, (counts.get(cite.url) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([url]) => url)
}

export interface StaleUpdate {
  claimId: string
  stale: StaleInfo | null
}

/**
 * Decide each claim's new stale state. `pageText` maps URL → current page
 * text, or null when the fetch failed (a failed fetch never flags or clears
 * anything — "we couldn't look" is not "it's gone"). Returns only claims
 * whose state changed, so a quiet week writes nothing.
 */
export function computeStaleUpdates(
  claims: CitedClaim[],
  pageText: Map<string, string | null>,
  now: string,
): StaleUpdate[] {
  const updates: StaleUpdate[] = []
  for (const claim of claims) {
    const checked = claim.citations.filter((c) => typeof pageText.get(c.url) === 'string')
    if (checked.length === 0) continue // nothing we could look at this run
    const missing = checked.filter((c) => !quoteAppearsIn(c.quote, pageText.get(c.url) as string))
    // A claim is stale only when NONE of its checkable quotes survive: one
    // remaining quote still backs the verdict.
    const nowStale = missing.length === checked.length
    const wasStale = !!claim.stale
    if (nowStale && !wasStale) {
      updates.push({ claimId: claim.claimId, stale: { detectedAt: now, missing } })
    } else if (!nowStale && wasStale) {
      updates.push({ claimId: claim.claimId, stale: null })
    }
  }
  return updates
}
