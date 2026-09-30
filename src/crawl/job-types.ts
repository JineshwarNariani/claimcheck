/** Shared by the client (enqueue) and the worker (handler). Keep this file
 *  free of worker imports so it can ship in the browser bundle. */

export const CRAWL_JOB_TYPE = 'crawl-source'

export interface CrawlPayload {
  sourceId: string
  url: string
  includePaths?: string[]
  pageLimit?: number
}
