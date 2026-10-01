/**
 * Docs sources — the ground truth claims are checked against.
 *
 * Admins add a docs site and start a crawl; everyone signed in sees crawl
 * progress live (useJobs) and the pages that were indexed. A source crawled
 * recently is reused rather than re-crawled, because every crawl bills the
 * app owner per page.
 */

import { useState, type FormEvent } from 'react'
import { useJobs, useMutations, useQuery, useUser } from 'deepspace'
import { Badge, Button, ConfirmModal, Input, Label, useToast } from '@/components/ui'
import { RecheckPanel } from '../../../components/RecheckPanel'
import { SCOPE_ID } from '../../../constants'
import { CRAWL_JOB_TYPE, type CrawlPayload } from '../../../crawl/job-types'
import { MAX_PAGES_PER_CRAWL, normalizeSourceUrl } from '../../../crawl/pages'
import type { DocPage, Source, SourceStatus } from '../../../schemas/sources-schema'

const FRESH_FOR_DAYS = 7

const STATUS_BADGE: Record<SourceStatus, 'secondary' | 'info' | 'warning' | 'success' | 'destructive'> = {
  queued: 'secondary',
  crawling: 'info',
  indexing: 'info',
  ready: 'success',
  failed: 'destructive',
}

export default function SourcesPage() {
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'
  const { records: sources } = useQuery<Source>('sources', { orderBy: 'createdAt', orderDir: 'desc' })
  const { enqueue, jobs } = useJobs<CrawlPayload>(SCOPE_ID)

  const activeJobFor = (sourceId: string) =>
    jobs.find((j) => j.payload?.sourceId === sourceId && (j.status === 'queued' || j.status === 'running'))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">Docs sources</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Claims are checked against these crawled docs. Each crawl is capped at {MAX_PAGES_PER_CRAWL} pages and
        reused by every check.
      </p>

      {isAdmin && <AddSourceForm enqueue={enqueue} />}

      <ul className="mt-8 space-y-4">
        {sources.length === 0 && <li className="text-sm text-muted-foreground">No sources yet.</li>}
        {sources.map((s) => (
          <SourceRow
            key={s.recordId}
            id={s.recordId}
            source={s.data}
            job={activeJobFor(s.recordId)}
            isAdmin={isAdmin}
            enqueue={enqueue}
          />
        ))}
      </ul>

      <RecheckPanel />
    </div>
  )
}

type Enqueue = ReturnType<typeof useJobs<CrawlPayload>>['enqueue']

function AddSourceForm({ enqueue }: { enqueue: Enqueue }) {
  const { createConfirmed } = useMutations<Source>('sources')
  const { error } = useToast()
  const [name, setName] = useState('DeepSpace docs')
  const [url, setUrl] = useState('https://docs.deep.space')
  const [paths, setPaths] = useState('')
  const [limit, setLimit] = useState(MAX_PAGES_PER_CRAWL)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const normalized = normalizeSourceUrl(url)
      const includePaths = paths.split(',').map((p) => p.trim()).filter(Boolean)
      const pageLimit = Math.min(Math.max(limit, 1), MAX_PAGES_PER_CRAWL)
      const sourceId = await createConfirmed({ name: name.trim() || normalized, url: normalized, includePaths, pageLimit, status: 'queued' })
      await enqueue(CRAWL_JOB_TYPE, { sourceId, url: normalized, includePaths, pageLimit }, { maxAttempts: 2 })
    } catch (err) {
      error('Could not start crawl', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
      <div className="grid gap-1">
        <Label htmlFor="src-name">Name</Label>
        <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="src-url">Docs URL</Label>
        <Input id="src-url" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="src-paths">Only paths matching (optional, comma-separated regex)</Label>
        <Input id="src-paths" placeholder="guides/.*, concepts/.*" value={paths} onChange={(e) => setPaths(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="src-limit">Page limit (max {MAX_PAGES_PER_CRAWL})</Label>
        <Input
          id="src-limit"
          type="number"
          min={1}
          max={MAX_PAGES_PER_CRAWL}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" loading={busy}>
          Add source and crawl
        </Button>
      </div>
    </form>
  )
}

function SourceRow({
  id,
  source,
  job,
  isAdmin,
  enqueue,
}: {
  id: string
  source: Source
  job: ReturnType<typeof useJobs<CrawlPayload>>['jobs'][number] | undefined
  isAdmin: boolean
  enqueue: Enqueue
}) {
  const [open, setOpen] = useState(false)
  const [recrawling, setRecrawling] = useState(false)
  const [limit, setLimit] = useState(MAX_PAGES_PER_CRAWL)
  const { putConfirmed } = useMutations<Source>('sources')
  const { error } = useToast()
  const ageDays = source.lastCrawledAt ? (Date.now() - Date.parse(source.lastCrawledAt)) / 86_400_000 : Infinity
  const fresh = ageDays < FRESH_FOR_DAYS

  const [confirming, setConfirming] = useState(false)

  /** A fresh crawl is reused by every check; ask before paying for another. */
  function requestRecrawl() {
    if (fresh) setConfirming(true)
    else void recrawl()
  }

  async function recrawl() {
    setConfirming(false)
    try {
      const pageLimit = Math.min(Math.max(limit, 1), MAX_PAGES_PER_CRAWL)
      await putConfirmed(id, { pageLimit })
      await enqueue(CRAWL_JOB_TYPE, { sourceId: id, url: source.url, includePaths: source.includePaths, pageLimit }, { maxAttempts: 2 })
      setRecrawling(false)
    } catch (err) {
      error('Could not start crawl', err instanceof Error ? err.message : String(err))
    }
  }

  /** Re-index from the last finished crawl (Firecrawl keeps results ~24h): no new crawl charge.
   *  The live index keeps serving until the rebuilt one is ready. */
  async function rebuild() {
    if (!source.crawlId) return
    try {
      await enqueue(CRAWL_JOB_TYPE, { sourceId: id, url: source.url, resumeCrawlId: source.crawlId }, { maxAttempts: 2 })
    } catch (err) {
      error('Could not start the rebuild', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{source.name}</span>
        <Badge variant={STATUS_BADGE[source.status] ?? 'secondary'}>{source.status}</Badge>
        <a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
          {source.url}
        </a>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {job?.progressMessage ?? source.statusMessage}
        {source.pageCount != null && ` · ${source.pageCount} pages`}
        {source.lastCrawledAt && ` · crawled ${new Date(source.lastCrawledAt).toLocaleString()}`}
        {source.costUsd != null && ` · crawl cost $${source.costUsd.toFixed(3)}`}
      </p>
      {job?.progress != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={Math.round(job.progress * 100)}>
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide pages' : 'Show pages'}
        </Button>
        {isAdmin && !job && !recrawling && (
          <Button size="sm" variant="ghost" onClick={() => setRecrawling(true)}>
            Re-crawl
          </Button>
        )}
        {isAdmin && !job && !recrawling && source.crawlId && (
          <Button size="sm" variant="ghost" onClick={rebuild}>
            Rebuild index (no new crawl)
          </Button>
        )}
        {isAdmin && !job && recrawling && (
          <div className="flex items-center gap-2">
            <Label htmlFor={`limit-${id}`} className="text-xs">
              Page limit
            </Label>
            <Input
              id={`limit-${id}`}
              type="number"
              min={1}
              max={MAX_PAGES_PER_CRAWL}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-9 w-20"
            />
            <Button size="sm" onClick={requestRecrawl}>
              Start crawl
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRecrawling(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      {open && <PageList sourceId={id} />}
      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void recrawl()}
        title={`Re-crawl ${source.name}?`}
        description={`It was crawled ${Math.floor(ageDays)} day(s) ago and every check already reuses that crawl. A new crawl bills the app owner again.`}
        confirmText="Crawl again"
        variant="default"
      />
    </li>
  )
}

function PageList({ sourceId }: { sourceId: string }) {
  const { records, status, error } = useQuery<DocPage>('doc_pages', { where: { sourceId }, limit: 100 })
  if (status === 'loading') {
    return (
      <div className="mt-3 space-y-1.5" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-muted" />
        ))}
      </div>
    )
  }
  if (status === 'error') return <p className="mt-3 text-xs text-destructive">Could not load pages: {error}</p>
  if (records.length === 0) return <p className="mt-3 text-xs text-muted-foreground">No pages indexed yet.</p>
  return (
    <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto text-xs">
      {records.map((p) => (
        <li key={p.recordId} className="flex justify-between gap-4">
          <a href={p.data.url} target="_blank" rel="noreferrer" className="truncate text-foreground hover:underline">
            {p.data.title}
          </a>
          <span className="shrink-0 text-muted-foreground">{p.data.chars.toLocaleString()} chars</span>
        </li>
      ))}
    </ul>
  )
}
