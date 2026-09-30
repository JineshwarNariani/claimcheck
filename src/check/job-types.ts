/** Shared by the startCheck action (enqueue) and the worker (handler). Keep
 *  this file free of worker imports so the browser bundle can use it. */

export const CHECK_JOB_TYPE = 'check-claims'

export interface CheckPayload {
  checkId: string
}

/** Input and spend limits — enforced by the startCheck server action. */
export const CHECK_LIMITS = {
  minChars: 40,
  maxChars: 6000,
  /** Per signed-in member per rolling 24 hours. A full check costs ~$0.40
   *  in real credits (measured 2026-09-30), and the owner's free credits are
   *  a one-time $5, so these stay small. */
  memberPerDay: 3,
  adminPerDay: 10,
  /** Across everyone, so a crowd of reviewers can't drain the budget. */
  appPerDay: 8,
} as const
