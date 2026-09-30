import { describe, expect, it } from 'vitest'
import { dedupeEvidence, groundVerdict, normalizeForMatch, quoteAppearsIn, type Evidence } from './grounding'

const docs: Evidence[] = [
  {
    url: 'https://docs.deep.space/guides/background-jobs',
    title: 'Background jobs',
    text: 'Use this **instead** of `ctx.waitUntil(...)`. `waitUntil` is killed 30 seconds after the response goes out - the JobRoom replaces that pattern.',
  },
  {
    url: 'https://docs.deep.space/concepts/permissions',
    title: 'Permissions',
    text: 'New authenticated users get `member` by default.',
  },
]

describe('quoteAppearsIn', () => {
  it('matches across markdown, smart quotes, dashes and whitespace', () => {
    expect(quoteAppearsIn('`waitUntil` is killed 30 seconds after the response goes out', docs[0].text)).toBe(true)
    expect(quoteAppearsIn('waitUntil is killed 30 seconds   after the response goes out – the JobRoom', docs[0].text)).toBe(true)
    expect(quoteAppearsIn('New authenticated users get “member” by default', docs[1].text.replace(/`/g, '"'))).toBe(true)
  })
  it('rejects paraphrases and quotes too short to prove anything', () => {
    expect(quoteAppearsIn('waitUntil stops after thirty seconds', docs[0].text)).toBe(false)
    expect(quoteAppearsIn('JobRoom', docs[0].text)).toBe(false)
  })
})

describe('groundVerdict', () => {
  it('keeps a supported verdict whose quote is in the cited evidence', () => {
    const g = groundVerdict(
      { verdict: 'supported', explanation: 'Stated directly.', citations: [{ evidence: 2, quote: 'New authenticated users get `member` by default' }] },
      docs,
    )
    expect(g.verdict).toBe('supported')
    expect(g.citations).toEqual([{ url: docs[1].url, title: 'Permissions', quote: 'New authenticated users get `member` by default' }])
    expect(g.rejectedQuotes).toBe(0)
  })
  it('downgrades to not_in_docs when every quote is invented or points at the wrong passage', () => {
    const g = groundVerdict(
      {
        verdict: 'contradicted',
        explanation: 'Docs say otherwise.',
        citations: [
          { evidence: 1, quote: 'New authenticated users get member by default' }, // real text, wrong item
          { evidence: 1, quote: 'jobs may run for up to one hour' }, // invented
          { evidence: 9, quote: 'the JobRoom replaces that pattern' }, // no such item
        ],
      },
      docs,
    )
    expect(g.verdict).toBe('not_in_docs')
    expect(g.citations).toEqual([])
    expect(g.rejectedQuotes).toBe(3)
  })
  it('lets unverifiable and not_in_docs stand without citations', () => {
    expect(groundVerdict({ verdict: 'unverifiable', explanation: 'Opinion.', citations: [] }, docs).verdict).toBe('unverifiable')
    expect(groundVerdict({ verdict: 'not_in_docs', explanation: 'Not covered.', citations: [] }, docs).verdict).toBe('not_in_docs')
  })
})

describe('dedupeEvidence', () => {
  it('drops the same passage from a .md twin page and caps the count', () => {
    const twin = { ...docs[0], url: docs[0].url + '.md' }
    const out = dedupeEvidence([docs[0], twin, docs[1]], 5)
    expect(out.map((e) => e.url)).toEqual([docs[0].url, docs[1].url])
    expect(dedupeEvidence([docs[0], docs[1]], 1)).toHaveLength(1)
  })
})

describe('normalizeForMatch', () => {
  it('keeps link text and drops link targets', () => {
    expect(normalizeForMatch('See [Server actions](/guides/server-actions) for more')).toBe('see server actions for more')
  })
})
