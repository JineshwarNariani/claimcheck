/**
 * One check: the original text with each claim's source span marked, and the
 * claims with verdicts, explanations and verified doc quotes. Updates live as
 * the job writes verdicts claim by claim.
 */

import { Fragment, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Badge } from '@/components/ui'
import { VERDICT_BADGE, VERDICT_LABEL } from '../../../../check/client'
import type { Check, Claim, Verdict } from '../../../../schemas/checks-schema'

const VERDICT_MARK: Record<Verdict, string> = {
  supported: 'bg-success/20 decoration-success',
  contradicted: 'bg-destructive/20 decoration-destructive',
  not_in_docs: 'bg-warning/25 decoration-warning',
  unverifiable: 'bg-muted decoration-muted-foreground',
}

export default function CheckDetailPage() {
  const { id = '' } = useParams()
  const { records: checkRows, status } = useQuery<Check>('checks', { where: { recordId: id }, limit: 1 })
  const { records: claimRows } = useQuery<Claim>('claims', { where: { checkId: id }, limit: 100 })
  const check = checkRows[0]?.data
  const claims = [...claimRows].sort((a, b) => a.data.index - b.data.index)

  if (status === 'loading') return <p className="px-4 py-8 text-sm text-muted-foreground">Loading…</p>
  if (!check) return <p className="px-4 py-8 text-sm text-muted-foreground">Check not found.</p>

  const counts = claims.reduce<Partial<Record<Verdict, number>>>((acc, c) => {
    if (c.data.verdict) acc[c.data.verdict] = (acc[c.data.verdict] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/check" className="text-xs text-muted-foreground hover:underline">
        ← All checks
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-foreground">{check.title}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={check.status === 'failed' ? 'destructive' : check.status === 'done' ? 'success' : 'info'}>{check.status}</Badge>
        {check.statusMessage}
        {check.usage && ` · est. $${check.usage.estimatedUsd.toFixed(3)}`}
      </p>

      {claims.length > 0 && (
        <p className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) =>
            counts[v] ? (
              <Badge key={v} variant={VERDICT_BADGE[v]}>
                {counts[v]} {VERDICT_LABEL[v].toLowerCase()}
              </Badge>
            ) : null,
          )}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Checked text</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {highlight(check.text, claims.map((c) => c.data))}
        </p>
      </section>

      <ol className="mt-6 space-y-3">
        {claims.map((c) => (
          <ClaimCard key={c.recordId} claim={c.data} />
        ))}
      </ol>
    </div>
  )
}

function ClaimCard({ claim }: { claim: Claim }) {
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {claim.index + 1}. {claim.text}
        </p>
        {claim.verdict ? (
          <Badge variant={VERDICT_BADGE[claim.verdict]} className="shrink-0">
            {VERDICT_LABEL[claim.verdict]}
          </Badge>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">checking…</span>
        )}
      </div>
      {claim.explanation && <p className="mt-2 text-sm text-muted-foreground">{claim.explanation}</p>}
      {claim.citations?.map((cite, i) => (
        <blockquote key={i} className="mt-3 border-l-2 border-border pl-3 text-sm">
          <p className="text-foreground">“{cite.quote}”</p>
          <a href={cite.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
            {cite.title}
          </a>
        </blockquote>
      ))}
      {!!claim.rejectedQuotes && (
        <p className="mt-2 text-xs text-muted-foreground">
          {claim.rejectedQuotes} quote{claim.rejectedQuotes > 1 ? 's' : ''} from the model could not be found in the docs
          and {claim.rejectedQuotes > 1 ? 'were' : 'was'} dropped.
        </p>
      )}
    </li>
  )
}

/** Mark each claim's span in the original text (first occurrence, no overlaps). */
function highlight(text: string, claims: Claim[]): ReactNode {
  const ranges: Array<{ start: number; end: number; claim: Claim }> = []
  for (const claim of claims) {
    if (!claim.span) continue
    const start = text.indexOf(claim.span)
    if (start < 0) continue
    const end = start + claim.span.length
    if (ranges.some((r) => start < r.end && end > r.start)) continue
    ranges.push({ start, end, claim })
  }
  ranges.sort((a, b) => a.start - b.start)

  const parts: ReactNode[] = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start > cursor) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, r.start)}</Fragment>)
    parts.push(
      <mark
        key={`m${r.start}`}
        title={`Claim ${r.claim.index + 1}${r.claim.verdict ? ` — ${VERDICT_LABEL[r.claim.verdict]}` : ''}`}
        className={`rounded px-0.5 text-foreground underline decoration-2 underline-offset-2 ${r.claim.verdict ? VERDICT_MARK[r.claim.verdict] : 'bg-transparent decoration-border'}`}
      >
        {text.slice(r.start, r.end)}
      </mark>,
    )
    cursor = r.end
  }
  if (cursor < text.length) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor)}</Fragment>)
  return parts
}
