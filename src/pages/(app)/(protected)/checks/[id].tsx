/**
 * One check, reviewed as a team: the original text with each claim's span
 * marked, claims with verdicts and verified doc quotes, teammates' reviews,
 * who else is looking (and at which claim), and a discussion thread.
 * Everything updates live — verdicts as the job writes them, reviews and
 * comments as teammates add them.
 */

import { Fragment, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, usePresenceRoom, useQuery } from 'deepspace'
import { TriangleAlert } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { VERDICT_BADGE, VERDICT_LABEL } from '../../../../check/client'
import { ClaimReview, reviewState } from '../../../../components/review/ClaimReview'
import { Discussion } from '../../../../components/review/Discussion'
import { Dot, ViewersBar, type Viewer } from '../../../../components/review/ViewersBar'
import type { Check, Claim, Review, Verdict } from '../../../../schemas/checks-schema'

const VERDICT_MARK: Record<Verdict, string> = {
  supported: 'bg-success/20 decoration-success',
  contradicted: 'bg-destructive/20 decoration-destructive',
  not_in_docs: 'bg-warning/25 decoration-warning',
  unverifiable: 'bg-muted decoration-muted-foreground',
}

export default function CheckDetailPage() {
  const { id = '' } = useParams()
  const { userId } = useAuth()
  const { records: checkRows, status } = useQuery<Check>('checks', { where: { recordId: id }, limit: 1 })
  const { records: claimRows } = useQuery<Claim>('claims', { where: { checkId: id }, limit: 100 })
  const { records: reviewRows } = useQuery<Review>('reviews', { where: { checkId: id }, limit: 500 })
  const { peers, connected, updateState } = usePresenceRoom(`check:${id}`)
  const [draft, setDraft] = useState('')

  const checkRow = checkRows[0]
  const check = checkRow?.data
  const claims = [...claimRows].sort((a, b) => a.data.index - b.data.index)
  const viewers: Viewer[] = peers.map((p) => ({
    userId: p.userId,
    userName: p.userName,
    claimIndex: typeof p.state.claimIndex === 'number' ? p.state.claimIndex : null,
  }))

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-8" aria-busy="true">
        <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-28 animate-pulse rounded-lg bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }
  if (!check || !checkRow) return <p className="px-4 py-8 text-sm text-muted-foreground">Check not found.</p>

  const isAuthor = checkRow.createdBy === userId
  const reviewsFor = (claimId: string) => reviewRows.filter((r) => r.data.claimId === claimId).map((r) => r.data)
  const counts = claims.reduce<Partial<Record<Verdict, number>>>((acc, c) => {
    if (c.data.verdict) acc[c.data.verdict] = (acc[c.data.verdict] ?? 0) + 1
    return acc
  }, {})
  const states = claims.map((c) => reviewState(reviewsFor(c.recordId)))
  const signedOff = states.filter((s) => s === 'signed-off').length
  const disputed = states.filter((s) => s === 'disputed').length
  const stale = claims.filter((c) => c.data.stale).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/check" className="text-xs text-muted-foreground hover:underline">
        ← All checks
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">{check.title}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={check.status === 'failed' ? 'destructive' : check.status === 'done' ? 'success' : 'info'}>{check.status}</Badge>
        {check.statusMessage}
        {check.usage && ` · est. $${check.usage.estimatedUsd.toFixed(3)}`}
      </p>
      <div className="mt-3">
        <ViewersBar viewers={viewers} connected={connected} />
      </div>

      {claims.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) =>
            counts[v] ? (
              <Badge key={v} variant={VERDICT_BADGE[v]}>
                {counts[v]} {VERDICT_LABEL[v].toLowerCase()}
              </Badge>
            ) : null,
          )}
          <span className="text-xs text-muted-foreground" data-testid="review-progress">
            · Review: {signedOff}/{claims.length} signed off{disputed ? `, ${disputed} disputed` : ''}
          </span>
          {stale > 0 && (
            <Badge variant="warning" data-testid="stale-count">
              {stale} stale
            </Badge>
          )}
        </div>
      )}

      <section className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Checked text</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {highlight(check.text, claims.map((c) => c.data))}
        </p>
      </section>

      <ol className="mt-6 space-y-3">
        {claims.map((c) => (
          <ClaimCard
            key={c.recordId}
            claimId={c.recordId}
            claim={c.data}
            reviews={reviewsFor(c.recordId)}
            here={viewers.filter((v) => v.claimIndex === c.data.index)}
            myUserId={userId}
            isAuthor={isAuthor}
            onFocus={() => updateState({ claimIndex: c.data.index })}
            onDiscuss={() => {
              setDraft(`Claim ${c.data.index + 1}: `)
              document.getElementById('discussion-input')?.focus()
            }}
          />
        ))}
      </ol>

      <Discussion checkId={id} channelId={check.channelId} draft={draft} setDraft={setDraft} />
    </div>
  )
}

function ClaimCard({
  claimId,
  claim,
  reviews,
  here,
  myUserId,
  isAuthor,
  onFocus,
  onDiscuss,
}: {
  claimId: string
  claim: Claim
  reviews: Review[]
  here: Viewer[]
  myUserId: string | null
  isAuthor: boolean
  onFocus: () => void
  onDiscuss: () => void
}) {
  const state = reviewState(reviews)
  return (
    <li
      className="rounded-lg border border-border bg-card p-4"
      onMouseEnter={onFocus}
      onFocusCapture={onFocus}
      data-testid="claim-card"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {claim.index + 1}. {claim.text}
        </p>
        <span className="flex shrink-0 items-center gap-1.5">
          {here.map((v) => (
            <span key={v.userId} title={`${v.userName} is looking at this claim`}>
              <Dot userId={v.userId} />
            </span>
          ))}
          {state !== 'unreviewed' && (
            <Badge size="sm" variant={state === 'disputed' ? 'warning' : 'outline'}>
              {state === 'disputed' ? 'Disputed' : 'Signed off'}
            </Badge>
          )}
          {claim.verdict ? (
            <Badge variant={VERDICT_BADGE[claim.verdict]}>{VERDICT_LABEL[claim.verdict]}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">checking…</span>
          )}
        </span>
      </div>
      {claim.stale && (
        <div className="mt-3 flex gap-2 rounded-md border border-warning bg-warning/10 p-3 text-sm" data-testid="stale-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-foreground">
            <span className="font-medium">The docs changed.</span> Since {new Date(claim.stale.detectedAt).toLocaleDateString()},
            the quote{claim.stale.missing.length > 1 ? 's' : ''} behind this verdict can no longer be found on the cited
            page{claim.stale.missing.length > 1 ? 's' : ''}. Re-check this claim before publishing.
          </p>
        </div>
      )}
      {claim.explanation && <p className="mt-2 text-sm text-muted-foreground">{claim.explanation}</p>}
      {claim.citations?.map((cite, i) => (
        <blockquote key={i} className="mt-3 border-l-2 border-border pl-3 text-sm">
          {/* The stored quote is exact (it was matched against the docs); drop
              markdown emphasis and code ticks only for display. */}
          <p className="font-serif italic text-foreground">“{cite.quote.replace(/\*\*|__|`/g, '')}”</p>
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
      {claim.verdict && (
        <>
          <ClaimReview claimId={claimId} modelVerdict={claim.verdict} reviews={reviews} myUserId={myUserId} isAuthor={isAuthor} />
          <Button size="sm" variant="link" className="mt-1 h-auto px-0 text-xs" onClick={onDiscuss}>
            Discuss this claim
          </Button>
        </>
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
