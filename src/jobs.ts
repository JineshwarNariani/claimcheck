/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every
 * job picked up from the queue. Dispatch on `job.type` and return a
 * result (captured as `job.result`) or throw to fail.
 *
 * Every job here spends the owner's integration credits, which is why
 * AppJobRoom only lets admins enqueue (see worker.ts). Members start checks
 * through the rate-limited `startCheck` server action, which enqueues
 * server-side.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { runCrawlJob } from './crawl/crawl-job'
import { CRAWL_JOB_TYPE } from './crawl/job-types'
import { runCheckJob } from './check/check-job'
import { CHECK_JOB_TYPE } from './check/job-types'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case CRAWL_JOB_TYPE:
      return runCrawlJob(job, ctx, env)
    case CHECK_JOB_TYPE:
      return runCheckJob(job, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}
