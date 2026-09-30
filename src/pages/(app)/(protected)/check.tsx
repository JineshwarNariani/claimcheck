/**
 * Start a check and browse recent ones. Any text works: launch copy, a tweet
 * thread, or an answer copied from an AI assistant about the product.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Badge, Button, Input, Label, Textarea, useToast } from '@/components/ui'
import { startCheck } from '../../../check/client'
import { CHECK_LIMITS } from '../../../check/job-types'
import type { Check } from '../../../schemas/checks-schema'
import type { Source } from '../../../schemas/sources-schema'

export default function CheckPage() {
  const navigate = useNavigate()
  const { error } = useToast()
  const { records: sources } = useQuery<Source>('sources', { where: { status: 'ready' } })
  const { records: checks } = useQuery<Check>('checks', { orderBy: 'createdAt', orderDir: 'desc', limit: 30 })
  const [sourceId, setSourceId] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const chosenSource = sourceId || sources[0]?.recordId || ''
  const sourceName = (id: string) => sources.find((s) => s.recordId === id)?.data.name ?? 'docs'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const checkId = await startCheck({ text, sourceId: chosenSource, title })
      navigate(`/checks/${checkId}`)
    } catch (err) {
      error('Could not start the check', err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Check claims</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste launch copy, a post, or an AI assistant&apos;s answer about the product. Each claim is checked against the
        docs, and every quote shown is verified word for word.
      </p>

      <form onSubmit={submit} className="mt-6 grid gap-3 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="check-source">Check against</Label>
            <select
              id="check-source"
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={chosenSource}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {sources.length === 0 && <option value="">No docs source is ready yet</option>}
              {sources.map((s) => (
                <option key={s.recordId} value={s.recordId}>
                  {s.data.name} ({s.data.pageCount ?? 0} pages)
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="check-title">Title (optional)</Label>
            <Input id="check-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch post draft" />
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="check-text">Text to check</Label>
          <Textarea id="check-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          <span className="text-xs text-muted-foreground">
            {text.trim().length}/{CHECK_LIMITS.maxChars} characters · {CHECK_LIMITS.memberPerDay} checks per person per day
          </span>
        </div>
        <div>
          <Button
            type="submit"
            loading={busy}
            disabled={!chosenSource || text.trim().length < CHECK_LIMITS.minChars || text.trim().length > CHECK_LIMITS.maxChars}
          >
            Check claims
          </Button>
        </div>
      </form>

      <h2 className="mt-10 text-lg font-semibold text-foreground">Recent checks</h2>
      <ul className="mt-3 space-y-2">
        {checks.length === 0 && <li className="text-sm text-muted-foreground">No checks yet.</li>}
        {checks.map((c) => (
          <li key={c.recordId}>
            <Link
              to={`/checks/${c.recordId}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-accent"
            >
              <span className="truncate text-sm text-foreground">{c.data.title}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                vs {sourceName(c.data.sourceId)}
                <Badge variant={c.data.status === 'failed' ? 'destructive' : c.data.status === 'done' ? 'success' : 'info'}>
                  {c.data.status}
                </Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
