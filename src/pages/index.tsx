/**
 * Design Direction
 *
 * Product: A pre-publish check for developer-tool teams: paste launch copy or
 *   an AI assistant's answer, get a verdict per claim, each backed by a quote
 *   that appears word for word in the product's own docs.
 * Emotion: The last read-through before you hit publish, pen in hand, knowing
 *   every sentence has been traced to a source.
 * Metaphor: A magazine fact-checker's galley proof — printed copy with
 *   blue-pencil underlines and margin marks, a citation slip clipped on.
 * References: The New Yorker's fact-checking desk; printers' proofreading
 *   marks (ISO 5776); library catalog index cards.
 * Signature: Claims underlined one at a time, each earning a margin mark —
 *   ✓ supported, ✗ contradicted, ? not in docs, ~ unverifiable.
 * Hero: In the first five seconds, four claims about a real product are
 *   underlined in sequence, their verdict marks appear in the margin, and the
 *   citation slip for the contradicted claim slides in with the exact quote.
 *
 * Style Tile
 * - Color: Warm proof-paper dominant, near-black ink, blue-pencil accent for
 *   actions only; verdict colors appear only as marks.
 * - Type: Source Serif 4 (headings, quoted passages) + Inter (body, UI) —
 *   checking is reading, so print-like headings and an interface that
 *   disappears.
 * - Theme: Light — this is careful reading of text, and proofs are paper.
 * - Art direction: Editorial — serif headlines, hairline rules, an asymmetric
 *   text-plus-margin grid instead of cards.
 * - Motion: Stillness, except one choreographed marking pass in the hero.
 * - Voice: Second person; no superlatives or claims the product can't back
 *   (this page should pass its own check); no exclamation points.
 *
 * Static page: no providers, prerendered to HTML (see prerender.ts). The app
 * itself lives behind /home and /check.
 */

import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Seo } from '../components/Seo'
import { ProofSheet } from '../components/landing/ProofSheet'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const REPO_URL = 'https://github.com/JineshwarNariani/claimcheck'

const STEPS = [
  {
    title: 'Split into claims',
    body: 'Each sentence becomes the separate claims it makes.',
  },
  {
    title: 'Quote, or it does not count',
    body: 'A verdict stands only if its quote appears word for word in the docs.',
  },
  {
    title: 'A teammate signs off',
    body: 'Whoever ran the check cannot approve it.',
  },
]

const VERDICTS = [
  { mark: '✓', name: 'Supported', tone: 'proof-supported', body: 'The docs say it.' },
  { mark: '✗', name: 'Contradicted', tone: 'proof-contradicted', body: 'The docs say otherwise.' },
  { mark: '?', name: 'Not in docs', tone: 'proof-not_in_docs', body: 'Checkable, but the docs are silent.' },
  { mark: '~', name: 'Unverifiable', tone: 'proof-unverifiable', body: 'Opinion or marketing language.' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="font-serif text-xl font-semibold tracking-tight">{APP_NAME}</span>
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </header>

        <main>
          <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 pt-10 lg:grid-cols-[1fr_1.15fr] lg:pt-16">
            <div>
              <h1 className="font-serif text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                Every claim, checked against the docs.
              </h1>
              <p className="mt-6 max-w-md text-lg text-muted-foreground">
                Paste a launch post, a landing page, or a chatbot&apos;s answer. You get a verdict per claim, with
                quotes you can verify.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to="/check"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Check your copy <ArrowRight className="size-4" aria-hidden />
                </Link>
                <a href="#how" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  How a check works
                </a>
              </div>
            </div>
            <ProofSheet />
          </section>

          <section id="how" className="border-t border-border">
            <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.15fr]">
              <h2 className="font-serif text-3xl font-semibold tracking-tight">How a check works</h2>
              <ol className="divide-y divide-border">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="grid grid-cols-[3rem_1fr] gap-4 py-6 first:pt-0">
                    <span className="font-serif text-3xl text-muted-foreground">{i + 1}</span>
                    <div>
                      <h3 className="text-base font-semibold">{step.title}</h3>
                      <p className="mt-1 text-muted-foreground">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-6 py-20">
              <h2 className="font-serif text-3xl font-semibold tracking-tight">Four verdicts, nothing in between</h2>
              <dl className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
                {VERDICTS.map((v) => (
                  <div key={v.name} className={`${v.tone} border-t-2 border-[var(--proof-color)] pt-4`}>
                    <dt className="flex items-baseline gap-2 font-semibold">
                      <span aria-hidden className="proof-glyph font-serif text-xl">
                        {v.mark}
                      </span>
                      {v.name}
                    </dt>
                    <dd className="mt-1 text-muted-foreground">{v.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section className="border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-serif text-3xl font-semibold tracking-tight">Check it before it ships.</h2>
              <Link
                to="/check"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Check your copy <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </section>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
            <span>Built on DeepSpace · verdicts by Claude, quotes checked by code</span>
            <a href={REPO_URL} className="hover:text-foreground">
              Source on GitHub
            </a>
          </div>
        </footer>
      </div>
    </>
  )
}
