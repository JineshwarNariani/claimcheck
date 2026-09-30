/** Browser-side helpers for checks. */

import { getAuthToken } from 'deepspace'
import type { Verdict } from '../schemas/checks-schema'

export async function startCheck(input: { text: string; sourceId: string; title?: string }): Promise<string> {
  const res = await fetch('/api/actions/startCheck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAuthToken()}` },
    body: JSON.stringify(input),
  })
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { checkId: string }; error?: string }
  if (!res.ok || !body.success || !body.data) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body.data.checkId
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
