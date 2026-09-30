/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the DO itself records executions, tracks history, and
 * pushes status to clients via the `/ws/cron/:roomId` WebSocket (the Sources
 * page shows it, and admins can trigger a run from there).
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { RECHECK_TASK } from './cron-task-names'
import { runRecheck } from './recheck/recheck-task'

export const tasks: CronTask[] = [
  // Weekly: docs change slowly, and each run re-fetches every cited page.
  { name: RECHECK_TASK, schedule: '0 9 * * 1', timezone: 'America/New_York' },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === RECHECK_TASK) {
    await runRecheck(env)
    return
  }
  throw new Error(`Unknown cron task: ${name}`)
}
