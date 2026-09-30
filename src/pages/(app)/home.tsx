/* home pattern: data-forward — claims waiting for your review, then your recent checks, above the fold */

/**
 * The review desk. Signed in: what needs your sign-off (checks run by
 * teammates with claims you haven't reviewed), your own recent checks with
 * their verdict tallies, and the primary action. Signed out: the same idea in
 * preview — a marked-up proof — with an inline sign-in.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuth, useQuery } from 'deepspace'
import { ClipboardCheck, FileSearch } from 'lucide-react'
import { Badge, Button, EmptyState } from '@/components/ui'
import { VERDICT_BADGE, VERDICT_LABEL } from '../../check/client'
import { ProofSheet } from '../../components/landing/ProofSheet'
import type { Check, Claim, Review, Verdict } from '../../schemas/checks-schema'

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return <DeskSkeleton />
  return isSignedIn ? <ReviewDesk /> : <SignedOutPreview />
}

function ReviewDesk() {
  const { userId } = useAuth()
  const navigate = useNavigate()
  const checks = useQuery<Check>('checks', { orderBy: 'createdAt', orderDir: 'desc', limit: 100 })
  const claims = useQuery<Claim>('claims', { limit: 1000 })
  const reviews = useQuery<Review>('reviews', { limit: 1000 })

  if (checks.status === 'loading' || claims.status === 'loading' || reviews.status === 'loading') {
    return <DeskSkeleton />
  }

  const claimsByCheck = new Map<string, Claim[]>()
  for (const c of claims.records) {
    claimsByCheck.set(c.data.checkId, [...(claimsByCheck.get(c.data.checkId) ?? []), c.data])
  }
  const myReviewed = new Set(reviews.records.filter((r) => r.data.reviewerId === userId).map((r) => r.data.claimId))

  const waiting = checks.records
    .filter((c) => c.createdBy !== userId && c.data.status === 'done')
    .map((c) => ({
      check: c,
      open: claims.records.filter((cl) => cl.data.checkId === c.recordId && !myReviewed.has(cl.recordId)).length,
    }))
    .filter((w) => w.open > 0)
  const mine = checks.records.filter((c) => c.createdBy === userId).slice(0, 8)
  const disputed = new Set(reviews.records.filter((r) => r.data.decision === 'disagree').map((r) => r.data.claimId)).size

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">Review desk</h1>
          <p className="mt-1 text-sm text-muted-foreground">Claims waiting on you, and the checks you ran.</p>
        </div>
        <Button onClick={() => navigate('/check')}>New check</Button>
      </div>

      <dl className="mt-8 grid grid-cols-2 divide-border rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-x">
        <Stat label="Checks run" value={checks.records.length} />
        <Stat label="Claims checked" value={claims.records.filter((c) => c.data.verdict).length} />
        <Stat label="Disputed claims" value={disputed} />
        <Stat label="Stale claims" value={claims.records.filter((c) => c.data.stale).length} />
      </dl>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Waiting for your review</h2>
        {waiting.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing waiting. Teammates&apos; checks show up here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {waiting.map(({ check, open }) => (
              <li key={check.recordId}>
                <Link to={`/checks/${check.recordId}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent">
                  <span className="truncate text-sm text-foreground">{check.data.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {open} claim{open === 1 ? '' : 's'} to review
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your checks</h2>
        {mine.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-card">
            <EmptyState
              icon={<FileSearch />}
              title="No checks yet"
              description="Paste launch copy or an AI assistant's answer to check it against the docs."
              action={{ label: 'New check', onClick: () => navigate('/check') }}
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {mine.map((c) => (
              <li key={c.recordId}>
                <Link to={`/checks/${c.recordId}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent">
                  <span className="truncate text-sm text-foreground">{c.data.title}</span>
                  <Tally claims={claimsByCheck.get(c.recordId) ?? []} status={c.data.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-serif text-2xl font-semibold text-foreground">{value}</dd>
    </div>
  )
}

function Tally({ claims, status }: { claims: Claim[]; status: Check['status'] }) {
  if (status !== 'done') {
    return (
      <Badge variant={status === 'failed' ? 'destructive' : 'info'} className="shrink-0">
        {status}
      </Badge>
    )
  }
  const counts = claims.reduce<Partial<Record<Verdict, number>>>((acc, c) => {
    if (c.verdict) acc[c.verdict] = (acc[c.verdict] ?? 0) + 1
    return acc
  }, {})
  return (
    <span className="flex shrink-0 gap-1">
      {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) =>
        counts[v] ? (
          <Badge key={v} size="sm" variant={VERDICT_BADGE[v]} title={VERDICT_LABEL[v]}>
            {counts[v]} {VERDICT_LABEL[v].toLowerCase()}
          </Badge>
        ) : null,
      )}
    </span>
  )
}

function SignedOutPreview() {
  const [signingIn, setSigningIn] = useState(false)
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">Review desk</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to check copy against the docs and review your team&apos;s checks. This is what a checked proof looks
          like.
        </p>
        <Button className="mt-6" onClick={() => setSigningIn(true)}>
          <ClipboardCheck aria-hidden /> Sign in to start checking
        </Button>
      </div>
      <ProofSheet />
      {signingIn && <AuthOverlay onClose={() => setSigningIn(false)} />}
    </div>
  )
}

function DeskSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="mt-8 h-20 animate-pulse rounded-lg bg-muted" />
      <div className="mt-10 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  )
}
