/**
 * The weekly citation re-check, as seen on the Sources page: when it runs,
 * what recent runs found and cost, and (for admins) a Run now button. The
 * schedule, trigger and run history come from the app's CronRoom via
 * useCronMonitor; the per-run findings come from the `rechecks` collection.
 */

import { useState } from 'react'
import { useCronMonitor, useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { SCOPE_ID } from '../constants'
import { RECHECK_TASK } from '../cron-task-names'
import type { Recheck } from '../schemas/checks-schema'

export function RecheckPanel() {
  const { tasks, canWrite, trigger, connected } = useCronMonitor(SCOPE_ID)
  const { records: runs } = useQuery<Recheck>('rechecks', { orderBy: 'startedAt', orderDir: 'desc', limit: 5 })
  const { success, error } = useToast()
  const [running, setRunning] = useState(false)
  const task = tasks.find((t) => t.name === RECHECK_TASK)

  async function runNow() {
    setRunning(true)
    const result = await trigger(RECHECK_TASK)
    setRunning(false)
    if (result.ok) success('Re-check finished', 'Stale claims, if any, are flagged on their checks.')
    else error('Re-check did not run', result.error ?? result.reason)
  }

  return (
    <section className="mt-10 rounded-lg border border-border bg-card p-4" data-testid="recheck-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Weekly citation re-check</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Re-reads every docs page a verdict cites and flags claims whose quotes are no longer there. No AI calls —
            the same word-for-word test that grounded the verdict.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {task?.nextRunAt ? `Next run ${new Date(task.nextRunAt).toLocaleString()}` : connected ? 'Mondays, 9:00 ET' : 'Connecting…'}
          </p>
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" loading={running} onClick={runNow}>
            Run now
          </Button>
        )}
      </div>

      {runs.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 font-medium">Run</th>
              <th className="py-1.5 font-medium">Pages</th>
              <th className="py-1.5 font-medium">Claims</th>
              <th className="py-1.5 font-medium">Newly stale</th>
              <th className="py-1.5 font-medium">Cleared</th>
              <th className="py-1.5 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.recordId} className="border-b border-border last:border-0 text-foreground">
                <td className="py-1.5">{new Date(r.data.startedAt).toLocaleString()}</td>
                <td className="py-1.5">
                  {r.data.pagesFetched}
                  {r.data.pagesFailed ? ` (${r.data.pagesFailed} failed)` : ''}
                </td>
                <td className="py-1.5">{r.data.claimsChecked}</td>
                <td className="py-1.5">{r.data.newlyStale}</td>
                <td className="py-1.5">{r.data.cleared}</td>
                <td className="py-1.5">${r.data.costUsd.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
