/**
 * Docs sources — the ground truth ClaimCheck verifies claims against.
 *
 * A source is one docs site (e.g. https://docs.deep.space). The crawl job
 * (src/jobs.ts) fills `doc_pages` with one row per crawled page and indexes
 * the page text into the app's managed knowledge base, so every later check
 * reuses the same crawl instead of paying for a new one.
 *
 * Crawls spend the owner's credits, so only admins create sources. The job
 * writes status/progress fields through the owner context (RBAC off).
 * Page text itself lives in the knowledge index, not in records, so members
 * never sync megabytes of markdown over the WebSocket.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const SOURCE_STATUSES = ['queued', 'crawling', 'indexing', 'ready', 'failed'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

export interface Source {
  name: string
  url: string
  includePaths?: string[]
  pageLimit: number
  status: SourceStatus
  statusMessage?: string
  pageCount?: number
  lastCrawledAt?: string
  costUsd?: number
  /** Firecrawl job id of the latest crawl — lets an interrupted index
   *  rebuild resume from the finished crawl instead of paying again. */
  crawlId?: string
}

export interface DocPage {
  sourceId: string
  url: string
  title: string
  /** Stable id derived from the URL; also the knowledge-base filename. */
  pageKey: string
  /** SHA-256 of the page markdown — lets a re-crawl detect changed pages. */
  contentHash: string
  chars: number
  knowledgeItemIds: string[]
  crawledAt: string
  /** Which crawl wrote this row, so a rebuild can tell old rows from new. */
  crawlId?: string
}

export const sourcesSchema: CollectionSchema = {
  name: 'sources',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'url', storage: 'text', interpretation: { kind: 'url' }, required: true },
    { name: 'includePaths', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'pageLimit', storage: 'number', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: [...SOURCE_STATUSES] } },
    { name: 'statusMessage', storage: 'text', interpretation: 'plain' },
    { name: 'pageCount', storage: 'number', interpretation: 'plain' },
    { name: 'lastCrawledAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'costUsd', storage: 'number', interpretation: 'plain' },
    { name: 'crawlId', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const docPagesSchema: CollectionSchema = {
  name: 'doc_pages',
  columns: [
    { name: 'sourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'url', storage: 'text', interpretation: { kind: 'url' }, required: true },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'pageKey', storage: 'text', interpretation: 'plain', required: true },
    { name: 'contentHash', storage: 'text', interpretation: 'plain' },
    { name: 'chars', storage: 'number', interpretation: 'plain' },
    { name: 'knowledgeItemIds', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'crawledAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'crawlId', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: true },
  },
}
