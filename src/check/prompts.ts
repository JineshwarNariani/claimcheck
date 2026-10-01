/**
 * Model prompts and output schemas for the check pipeline.
 *
 * Two models on purpose: a cheap one splits text into claims (a mechanical
 * task), a stronger one judges each claim against evidence (the part people
 * will scrutinize). Model ids are the ones DeepSpace's AI proxy serves.
 */

import { z } from 'zod'
import { VERDICTS } from '../schemas/checks-schema'
import type { Evidence } from './grounding'

export const EXTRACT_MODEL = 'claude-haiku-4-5'
export const VERDICT_MODEL = 'claude-sonnet-5'
/** Thinking stays on (adaptive) at low effort. Measured 2026-09-30: turning
 *  it off changed neither accuracy (6/6 both ways) nor cost ($0.2048 vs
 *  $0.2044) — at low effort Sonnet 5 barely thinks on this task. */
export const VERDICT_PROVIDER_OPTIONS = { anthropic: { effort: 'low' } } as const

/** What DeepSpace actually bills per million tokens (input, output), for the
 *  cost estimate stored on each check. Measured 2026-09-30 by pairing each
 *  call's logged tokens with its charge in `deepspace app usage`: Haiku 4.5 at
 *  1.3x Anthropic list ($1/$5), Sonnet 5 at 4.0x list ($2/$10) on all six
 *  verdict calls. `deepspace app usage` remains the source of truth. */
export const PRICE_PER_MTOK: Record<string, [number, number]> = {
  [EXTRACT_MODEL]: [1.3, 6.5],
  [VERDICT_MODEL]: [8, 40],
}
export const SEARCH_PRICE_USD = 0.00075

export const MAX_CLAIMS = 12

export const extractSchema = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().describe('The claim restated as one self-contained sentence.'),
        span: z.string().describe('The exact words from the text this claim comes from, copied verbatim.'),
      }),
    )
    .max(MAX_CLAIMS),
})

export const EXTRACT_SYSTEM = `You split product copy into the individual claims it makes about a software product, so each claim can be checked against that product's documentation.

Rules:
- One claim per distinct statement of fact or capability. Split sentences that bundle several ("X handles auth, data and payments" is three claims).
- Restate each claim so it stands alone: resolve "it", "this", "we" to the product or feature named in the text.
- Every sentence that says something about the product or how people experience it yields at least one claim — including opinions, superlatives and praise ("the fastest way to ship", "building feels effortless", "developers love it"). Never drop these: they are judged unverifiable later, and reviewers need to see them.
- Skip only greetings, calls to action, and questions.
- "span" must be copied character for character from the text.
- At most ${MAX_CLAIMS} claims; if there are more, keep the most specific, checkable ones.`

export const verdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  explanation: z.string().describe('One or two sentences a reviewer can check against the quotes.'),
  citations: z.array(
    z.object({
      evidence: z.number().int().describe('The number of the evidence passage the quote is from.'),
      quote: z.string().describe('Words copied exactly from that passage.'),
    }),
  ),
})

export const VERDICT_SYSTEM = `You check one claim about a software product against passages from its official documentation.

Choose exactly one verdict:
- supported: a passage states the claim, or states something that directly entails it.
- contradicted: a passage explicitly rules the claim out — the two cannot both be true. Docs that describe something else (e.g. only a JavaScript SDK when the claim is about a Python SDK) do not rule it out; that is not_in_docs.
- not_in_docs: the claim is a checkable statement of fact, but the passages do not settle it.
- unverifiable: the claim is opinion, marketing language, a comparison with unnamed competitors, or a prediction — documentation could not confirm it either way.

Rules:
- Judge only from the passages. Do not use outside knowledge about the product, even if you believe the claim is true.
- A passage that is merely on the same topic is not support. Partial support is not support: if part of the claim is backed and part is not, use not_in_docs and say which part is missing.
- For supported and contradicted, cite at least one passage. Each quote must be copied exactly from the passage — a short, specific sentence or phrase, not a paraphrase. Citations are checked mechanically; a verdict whose quotes cannot be found is thrown out.
- For not_in_docs and unverifiable, cite nothing unless a passage is genuinely relevant.`

export function verdictPrompt(claim: string, evidence: Evidence[]): string {
  const passages = evidence.length
    ? evidence.map((e, i) => `<passage number="${i + 1}" title="${e.title}" url="${e.url}">\n${e.text}\n</passage>`).join('\n\n')
    : '(The documentation search returned no passages.)'
  return `<claim>${claim}</claim>\n\n<passages>\n${passages}\n</passages>`
}
