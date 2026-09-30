/**
 * Who else has this check open, via an ephemeral PresenceRoom (nothing is
 * stored). Each viewer broadcasts the claim they are looking at, so the
 * claim cards can show "Alex is here" while a team reviews together.
 */

import { getUserColor } from 'deepspace'

export interface Viewer {
  userId: string
  userName: string
  claimIndex: number | null
}

export function ViewersBar({ viewers, connected }: { viewers: Viewer[]; connected: boolean }) {
  if (!connected) return <p className="text-xs text-muted-foreground">Reconnecting…</p>
  if (viewers.length === 0) return <p className="text-xs text-muted-foreground">Only you are viewing this check.</p>
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="viewers-bar">
      <span>Also viewing:</span>
      {viewers.map((v) => (
        <span key={v.userId} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-foreground">
          <Dot userId={v.userId} />
          {v.userName}
          {v.claimIndex != null && <span className="text-muted-foreground">· claim {v.claimIndex + 1}</span>}
        </span>
      ))}
    </div>
  )
}

export function Dot({ userId }: { userId: string }) {
  return <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: getUserColor(userId) }} />
}
