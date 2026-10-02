/** Browser-side helpers for checks. */

import { getAuthToken } from 'deepspace'
import type { ReviewDecision, Verdict } from '../schemas/checks-schema'

async function callAction<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAuthToken()}` },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string }
  if (!res.ok || !body.success || body.data === undefined) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body.data
}

export async function startCheck(input: { text: string; sourceId: string; title?: string }): Promise<string> {
  return (await callAction<{ checkId: string }>('startCheck', input)).checkId
}

export async function reviewClaim(input: {
  claimId: string
  decision: ReviewDecision
  verdict?: Verdict
  note?: string
}): Promise<void> {
  await callAction('reviewClaim', input)
}

export async function restoreSource(sourceId: string): Promise<void> {
  await callAction('restoreSource', { sourceId })
}

export async function openDiscussion(checkId: string): Promise<string> {
  return (await callAction<{ channelId: string }>('openDiscussion', { checkId })).channelId
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  not_in_docs: 'Not in docs',
  unverifiable: 'Unverifiable',
}

export const VERDICT_BADGE: Record<Verdict, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  supported: 'success',
  contradicted: 'destructive',
  not_in_docs: 'warning',
  unverifiable: 'secondary',
}
