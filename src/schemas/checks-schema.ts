/**
 * Checks and their claims.
 *
 * A check is one pasted text (launch post, landing copy, an AI assistant's
 * answer...) verified against one docs source. The `check-claims` job splits
 * it into claims and writes one `claims` row per claim with a verdict and the
 * doc passages that back it.
 *
 * Checks spend the owner's credits, so nobody creates them directly: the
 * `startCheck` server action validates the input, enforces daily limits, then
 * creates the row and enqueues the job. Everyone signed in can read every
 * check — it is a shared review workspace.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const CHECK_STATUSES = ['queued', 'extracting', 'verifying', 'done', 'failed'] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

/**
 * - supported: the docs state it.
 * - contradicted: the docs state otherwise.
 * - not_in_docs: a checkable fact the docs don't address.
 * - unverifiable: opinion, marketing language or a prediction — nothing in
 *   any docs could confirm it.
 */
export const VERDICTS = ['supported', 'contradicted', 'not_in_docs', 'unverifiable'] as const
export type Verdict = (typeof VERDICTS)[number]

export interface Citation {
  url: string
  title: string
  quote: string
}

export interface Check {
  title: string
  text: string
  sourceId: string
  status: CheckStatus
  statusMessage?: string
  claimCount?: number
  /** Token usage across every model call, for cost reporting. */
  usage?: { inputTokens: number; outputTokens: number; searches: number; estimatedUsd: number }
  /** Discussion channel (bundled messaging schemas), created on first open. */
  channelId?: string
}

export interface Claim {
  checkId: string
  index: number
  text: string
  /** The exact words in the checked text this claim came from, if found. */
  span?: string
  verdict?: Verdict
  explanation?: string
  citations?: Citation[]
  /** Quotes the model cited that do not appear word for word in the evidence. */
  rejectedQuotes?: number
}

export const checksSchema: CollectionSchema = {
  name: 'checks',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'text', storage: 'text', interpretation: 'plain', required: true },
    { name: 'sourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: [...CHECK_STATUSES] } },
    { name: 'statusMessage', storage: 'text', interpretation: 'plain' },
    { name: 'claimCount', storage: 'number', interpretation: 'plain' },
    { name: 'usage', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'channelId', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: 'own' },
    admin: { read: true, create: false, update: true, delete: true },
  },
}

export const claimsSchema: CollectionSchema = {
  name: 'claims',
  columns: [
    { name: 'checkId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'index', storage: 'number', interpretation: 'plain' },
    { name: 'text', storage: 'text', interpretation: 'plain', required: true },
    { name: 'span', storage: 'text', interpretation: 'plain' },
    { name: 'verdict', storage: 'text', interpretation: { kind: 'select', options: [...VERDICTS] } },
    { name: 'explanation', storage: 'text', interpretation: 'plain' },
    { name: 'citations', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'rejectedQuotes', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: true, delete: true },
  },
}

export const REVIEW_DECISIONS = ['agree', 'disagree'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export interface Review {
  checkId: string
  claimId: string
  reviewerId: string
  decision: ReviewDecision
  /** The reviewer's own verdict when they disagree with the model's. */
  verdict?: Verdict
  note?: string
}

/**
 * A teammate's sign-off on one claim's verdict.
 *
 * The room enforces one review per reviewer per claim (`uniqueOn` +
 * `userBound` reviewer), and a reviewer can retract only their own. Rows are
 * written only by the `reviewClaim` server action, because the rule "the
 * person who ran the check cannot review it" compares two records, which a
 * per-collection permission cannot express.
 */
export const reviewsSchema: CollectionSchema = {
  name: 'reviews',
  columns: [
    { name: 'checkId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'claimId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'reviewerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'decision', storage: 'text', interpretation: { kind: 'select', options: [...REVIEW_DECISIONS] }, required: true },
    { name: 'verdict', storage: 'text', interpretation: { kind: 'select', options: [...VERDICTS] } },
    { name: 'note', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['claimId', 'reviewerId'],
  ownerField: 'reviewerId',
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: 'own' },
    admin: { read: true, create: false, update: false, delete: true },
  },
}
