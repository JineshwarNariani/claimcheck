import { describe, expect, it } from 'vitest'
import { computeStaleUpdates, pagesToFetch, type CitedClaim } from './staleness'

const A = 'https://docs.deep.space/guides/installation'
const B = 'https://docs.deep.space/concepts/architecture'
const NOW = '2026-10-05T13:00:00.000Z'

const claim = (id: string, cites: Array<[string, string]>, stale: CitedClaim['stale'] = null): CitedClaim => ({
  claimId: id,
  citations: cites.map(([url, quote]) => ({ url, title: 't', quote })),
  stale,
})

describe('pagesToFetch', () => {
  it('dedupes, puts the most-cited page first, and caps the count', () => {
    const claims = [claim('1', [[B, 'x'.repeat(20)]]), claim('2', [[A, 'y'.repeat(20)], [B, 'z'.repeat(20)]])]
    expect(pagesToFetch(claims)).toEqual([B, A])
    expect(pagesToFetch(claims, 1)).toEqual([B])
  })
})

describe('computeStaleUpdates', () => {
  const quote = 'You do not need a Cloudflare account.'
  const page = 'Prerequisites. You do **not** need a Cloudflare account. DeepSpace deploys to a shared namespace.'

  it('changes nothing while the quote is still on the page', () => {
    expect(computeStaleUpdates([claim('1', [[A, quote]])], new Map([[A, page]]), NOW)).toEqual([])
  })

  it('flags a claim whose only quote disappeared, recording what went missing', () => {
    const edited = 'Prerequisites. Bring your own Cloudflare account.'
    const [u] = computeStaleUpdates([claim('1', [[A, quote]])], new Map([[A, edited]]), NOW)
    expect(u).toEqual({ claimId: '1', stale: { detectedAt: NOW, missing: [{ url: A, title: 't', quote }] } })
  })

  it('keeps a claim fresh while at least one of its quotes survives', () => {
    const c = claim('1', [[A, quote], [B, 'A DeepSpace app is a normal Cloudflare Worker.']])
    const pages = new Map([[A, 'rewritten page'], [B, 'A DeepSpace app is a normal Cloudflare Worker.']])
    expect(computeStaleUpdates([c], pages, NOW)).toEqual([])
  })

  it('never flags or clears on a failed fetch', () => {
    const wasStale = claim('1', [[A, quote]], { detectedAt: 'earlier', missing: [] })
    expect(computeStaleUpdates([claim('2', [[A, quote]]), wasStale], new Map([[A, null]]), NOW)).toEqual([])
  })

  it('clears the flag when the quote comes back', () => {
    const wasStale = claim('1', [[A, quote]], { detectedAt: 'earlier', missing: [] })
    expect(computeStaleUpdates([wasStale], new Map([[A, page]]), NOW)).toEqual([{ claimId: '1', stale: null }])
  })
})
