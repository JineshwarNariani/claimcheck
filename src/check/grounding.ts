/**
 * Deterministic grounding — the part of a verdict that does not trust the
 * model. Every quote the model cites must appear word for word in the
 * evidence we handed it; a "supported" or "contradicted" verdict left with no
 * verifiable quote is downgraded to "not_in_docs".
 *
 * Pure functions, unit-tested in grounding.test.ts.
 */

import type { Citation, Verdict } from '../schemas/checks-schema'

/** Quotes shorter than this prove nothing ("the", "DeepSpace"). */
export const MIN_QUOTE_CHARS = 12

/**
 * Normalize text for quote matching: markdown emphasis, code ticks, smart
 * quotes, dash variants and whitespace differ between the crawled markdown
 * and what a model copies back, without changing what the text says.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[*_`]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links → their text
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function quoteAppearsIn(quote: string, evidence: string): boolean {
  const q = normalizeForMatch(quote)
  if (q.length < MIN_QUOTE_CHARS) return false
  return normalizeForMatch(evidence).includes(q)
}

export interface Evidence {
  url: string
  title: string
  text: string
}

export interface ModelVerdict {
  verdict: Verdict
  explanation: string
  citations: Array<{ evidence: number; quote: string }>
}

export interface GroundedVerdict {
  verdict: Verdict
  explanation: string
  citations: Citation[]
  rejectedQuotes: number
}

/**
 * Keep only citations whose quote is really in the numbered evidence item
 * (1-based, as shown to the model). A supported/contradicted verdict needs at
 * least one surviving citation.
 */
export function groundVerdict(model: ModelVerdict, evidence: Evidence[]): GroundedVerdict {
  const citations: Citation[] = []
  let rejectedQuotes = 0
  for (const c of model.citations) {
    const item = evidence[c.evidence - 1]
    if (item && quoteAppearsIn(c.quote, item.text)) {
      if (!citations.some((kept) => kept.url === item.url && kept.quote === c.quote)) {
        citations.push({ url: item.url, title: item.title, quote: c.quote.trim() })
      }
    } else {
      rejectedQuotes++
    }
  }

  const needsProof = model.verdict === 'supported' || model.verdict === 'contradicted'
  if (needsProof && citations.length === 0) {
    return {
      verdict: 'not_in_docs',
      explanation:
        `The model said "${model.verdict}", but none of its quotes appear word for word in the docs, ` +
        'so ClaimCheck treats the claim as not backed by the docs.',
      citations: [],
      rejectedQuotes,
    }
  }
  return { verdict: model.verdict, explanation: model.explanation, citations, rejectedQuotes }
}

/**
 * Collapse search hits that point at the same page and passage (the index can
 * hold `/x` and its `/x.md` twin from older crawls), keep the best-scored
 * first, and cap how many passages the model sees.
 */
export function dedupeEvidence(hits: Evidence[], max: number): Evidence[] {
  const out: Evidence[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const key = normalizeForMatch(hit.text).slice(0, 200)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
    if (out.length >= max) break
  }
  return out
}
