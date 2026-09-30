/**
 * Reviews on one claim: teammates agree with the verdict or disagree and say
 * what it should be. The person who ran the check sees the reviews but gets
 * no controls — the reviewClaim action refuses self-review anyway; hiding
 * the buttons just makes that rule visible.
 */

import { useState } from 'react'
import { useUserLookup } from 'deepspace'
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, useToast } from '@/components/ui'
import { reviewClaim, VERDICT_LABEL } from '../../check/client'
import { VERDICTS, type Review, type Verdict } from '../../schemas/checks-schema'

export type ReviewState = 'unreviewed' | 'signed-off' | 'disputed'

export function reviewState(reviews: Review[]): ReviewState {
  if (reviews.some((r) => r.decision === 'disagree')) return 'disputed'
  return reviews.length > 0 ? 'signed-off' : 'unreviewed'
}

export function ClaimReview({
  claimId,
  modelVerdict,
  reviews,
  myUserId,
  isAuthor,
}: {
  claimId: string
  modelVerdict: Verdict
  reviews: Review[]
  myUserId: string | null
  isAuthor: boolean
}) {
  const { getName } = useUserLookup()
  const { error } = useToast()
  const mine = reviews.find((r) => r.reviewerId === myUserId)
  const [disagreeing, setDisagreeing] = useState(false)
  const [verdict, setVerdict] = useState<Verdict>(VERDICTS.find((v) => v !== modelVerdict) ?? 'not_in_docs')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(decision: 'agree' | 'disagree') {
    setBusy(true)
    try {
      await reviewClaim({ claimId, decision, ...(decision === 'disagree' ? { verdict } : {}), note })
      setDisagreeing(false)
      setNote('')
    } catch (err) {
      error('Review not saved', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="claim-review">
      {reviews.length > 0 && (
        <ul className="space-y-1 text-xs">
          {reviews.map((r) => (
            <li key={r.reviewerId} className="text-muted-foreground">
              <span className="font-medium text-foreground">{getName(r.reviewerId) ?? 'A teammate'}</span>{' '}
              {r.decision === 'agree' ? (
                'agrees'
              ) : (
                <>
                  says <Badge size="sm" variant="outline">{r.verdict ? VERDICT_LABEL[r.verdict] : '?'}</Badge>
                </>
              )}
              {r.note && <> — “{r.note}”</>}
            </li>
          ))}
        </ul>
      )}

      {isAuthor ? (
        <p className="mt-1 text-xs text-muted-foreground">You ran this check, so a teammate reviews it.</p>
      ) : disagreeing ? (
        <div className="mt-2 grid gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>The verdict should be</span>
            <Select value={verdict} onValueChange={(v) => setVerdict(v as Verdict)}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Your verdict">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERDICTS.filter((v) => v !== modelVerdict).map((v) => (
                  <SelectItem key={v} value={v}>
                    {VERDICT_LABEL[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea rows={2} placeholder="Why? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => submit('disagree')}>
              Save review
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDisagreeing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="outline" loading={busy} onClick={() => submit('agree')} disabled={mine?.decision === 'agree'}>
            {mine?.decision === 'agree' ? 'You agreed' : 'Agree'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDisagreeing(true)}>
            {mine?.decision === 'disagree' ? 'Change my verdict' : 'Disagree'}
          </Button>
        </div>
      )}
    </div>
  )
}
