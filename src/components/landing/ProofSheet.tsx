/**
 * The landing hero's signature element: a galley proof of launch copy, where
 * each claim is underlined in turn and a margin mark states its verdict — the
 * way a fact-checker marks a proof before it goes to print.
 *
 * The claims, verdicts and quotes are the real results of ClaimCheck's
 * known-answer test against docs.deep.space (see AGENT_LOG.md), not invented
 * examples. Animation is CSS-only (keyframes in styles.css) so the page
 * prerenders as static HTML; `prefers-reduced-motion` shows the final state.
 */

import type { Verdict } from '../../schemas/checks-schema'

interface ProofClaim {
  text: string
  verdict: Verdict
  mark: string
  label: string
}

const COPY: Array<string | ProofClaim> = [
  { text: 'DeepSpace deploys your app to Cloudflare Workers.', verdict: 'supported', mark: '✓', label: 'Supported' },
  ' ',
  { text: 'You need your own Cloudflare account to deploy.', verdict: 'contradicted', mark: '✗', label: 'Contradicted' },
  ' ',
  { text: 'It is SOC 2 Type II certified,', verdict: 'not_in_docs', mark: '?', label: 'Not in docs' },
  ' and ',
  { text: 'it is the fastest way to ship a production app.', verdict: 'unverifiable', mark: '~', label: 'Unverifiable' },
]

const STEP_S = 1.1

export function ProofSheet() {
  let claimIndex = -1
  const claims = COPY.filter((part): part is ProofClaim => typeof part !== 'string')

  return (
    <figure className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
      <figcaption className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
        Galley · checked against docs.deep.space
      </figcaption>

      <div className="mt-5 grid gap-6 sm:grid-cols-[1fr_9.5rem]">
        <p className="font-serif text-xl leading-[1.9] text-foreground">
          {COPY.map((part, i) => {
            if (typeof part === 'string') return <span key={i}>{part}</span>
            claimIndex++
            return (
              <span
                key={i}
                className={`proof-underline proof-${part.verdict}`}
                style={{ animationDelay: `${0.4 + claimIndex * STEP_S}s` }}
              >
                {part.text}
              </span>
            )
          })}
        </p>

        <ol className="grid content-start gap-3 border-t border-border pt-4 text-sm sm:border-l sm:border-t-0 sm:pl-5 sm:pt-1">
          {claims.map((c, i) => (
            <li
              key={c.text}
              className={`proof-mark proof-${c.verdict} flex items-baseline gap-2`}
              style={{ animationDelay: `${0.9 + i * STEP_S}s` }}
            >
              <span aria-hidden className="proof-glyph w-4 text-center font-serif text-lg font-semibold">
                {c.mark}
              </span>
              <span className="text-foreground">{c.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <blockquote
        className="proof-mark mt-6 border-l-2 border-destructive pl-4"
        style={{ animationDelay: `${1.3 + STEP_S}s` }}
      >
        <p className="font-serif italic text-foreground">
          “You do not need a Cloudflare account. DeepSpace deploys to a shared Workers for Platforms namespace
          operated by the platform.”
        </p>
        <footer className="mt-1 text-xs text-muted-foreground">
          Installation · quote found word for word in the docs
        </footer>
      </blockquote>
    </figure>
  )
}
