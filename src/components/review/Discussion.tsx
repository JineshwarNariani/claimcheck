/**
 * The check's discussion thread, on DeepSpace's bundled messaging schemas.
 * The channel is created on first open by the openDiscussion action, so a
 * check nobody discusses never gets one.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { useMessages, useUserLookup } from 'deepspace'
import { Button, Textarea, useToast } from '@/components/ui'
import { openDiscussion } from '../../check/client'
import { Dot } from './ViewersBar'

export function Discussion({
  checkId,
  channelId: knownChannelId,
  draft,
  setDraft,
}: {
  checkId: string
  channelId?: string
  draft: string
  setDraft: (v: string) => void
}) {
  const { error } = useToast()
  const [channelId, setChannelId] = useState(knownChannelId)

  useEffect(() => {
    if (knownChannelId) setChannelId(knownChannelId)
    else openDiscussion(checkId).then(setChannelId, (err: unknown) => error('Discussion unavailable', String(err)))
  }, [checkId, knownChannelId, error])

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-4" data-testid="discussion">
      <h2 className="text-sm font-medium text-foreground">Discussion</h2>
      {channelId ? (
        <Thread channelId={channelId} draft={draft} setDraft={setDraft} />
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Opening…</p>
      )}
    </section>
  )
}

function Thread({ channelId, draft, setDraft }: { channelId: string; draft: string; setDraft: (v: string) => void }) {
  const { messages, send } = useMessages(channelId)
  const { getName } = useUserLookup()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    send(draft.trim())
    setDraft('')
  }

  return (
    <>
      <ul className="mt-3 space-y-2">
        {messages.length === 0 && <li className="text-xs text-muted-foreground">No comments yet.</li>}
        {messages.map((m) => (
          <li key={m.recordId} className="text-sm">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Dot userId={m.data.authorId} />
              <span className="font-medium text-foreground">{getName(m.data.authorId) ?? 'A teammate'}</span>
              {new Date(m.createdAt).toLocaleString()}
            </span>
            <p className="mt-0.5 whitespace-pre-wrap text-foreground">{m.data.deleted ? '[deleted]' : m.data.content}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 grid gap-2">
        <Textarea
          id="discussion-input"
          rows={2}
          placeholder="Comment on the check or a claim…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div>
          <Button size="sm" type="submit" disabled={!draft.trim()}>
            Comment
          </Button>
        </div>
      </form>
    </>
  )
}
