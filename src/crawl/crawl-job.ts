/**
 * `crawl-source` job — crawl one docs site with Firecrawl and index every page
 * into the app's managed knowledge base.
 *
 * Firecrawl crawls are asynchronous, so the job is a small state machine that
 * checkpoints with `ctx.continue(state)` between polls instead of sleeping in
 * one long handler:
 *
 *   (start) ──firecrawl/crawl──▶ poll ──get-crawl until done──▶ add ──new pages, 10/tick──▶
 *   index ──kb.list until indexed──▶ ready (searches switch folders) ──▶ cleanup ──old rows, 15/tick
 *
 * Each crawl writes to its own knowledge folder ("generation"), and searches
 * move to it only once it is indexed, so the live index keeps answering
 * during a rebuild. The slow part — removing the previous generation — runs
 * after the switch. Pages are uploaded as heading-level sections
 * (splitIntoSections) rather than whole pages.
 *
 * Checkpointing matters for money as much as for time limits: if the worker
 * restarts mid-crawl, the retry resumes polling the SAME Firecrawl job from
 * `job.resumeFrom` instead of paying for a second crawl. Index replacement is
 * batched too: one alarm has a 15-minute wall-time limit, and swapping ~70
 * pages (each a knowledge-base remove or add plus a record write) in a single
 * alarm blew through it on 2026-10-01. The `add` phase re-reads the finished
 * crawl with get-crawl (free) each tick, and skips pages this crawl already
 * wrote, so any tick can be retried.
 */

import { buildCronContext, knowledge } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { DocPage, Source } from '../schemas/sources-schema'
import type { CrawlPayload } from './job-types'
import {
  DEFAULT_EXCLUDE_PATHS,
  clampPageLimit,
  extractPages,
  knowledgeFolderFor,
  normalizeSourceUrl,
  pageKeyFor,
  sha256Hex,
  splitIntoSections,
  type CrawledPage,
} from './pages'

/** `generation` names this index build: its knowledge folder and the
 *  `crawlId` tag on its rows. It equals the Firecrawl job id for a fresh
 *  crawl, and is a new id for a rebuild from an existing crawl — otherwise a
 *  rebuild would see the previous build's rows as already written. */
type Rebuild = { firecrawlJobId: string; generation: string; costUsd: number; note?: string }
type CrawlState =
  | { phase: 'poll'; firecrawlJobId: string; startedAt: number }
  | ({ phase: 'add'; next: number } & Rebuild)
  | ({ phase: 'index'; startedAt: number; pageCount: number } & Rebuild)
  | ({ phase: 'cleanup' } & Rebuild)

const REMOVE_BATCH = 15
const ADD_BATCH = 10

const POLL_MS = 5_000
const INDEX_POLL_MS = 30_000
const CRAWL_DEADLINE_MS = 10 * 60_000
// The managed index processes uploads in the background; a 69-page rebuild
// still had 55 pages queued after 5 minutes (2026-10-01), so wait longer
// before calling the source ready. Each wait tick is one free kb.list.
const INDEX_DEADLINE_MS = 30 * 60_000

interface GetCrawlResult {
  status: string
  completed?: number | null
  total?: number | null
  costUsd?: number
  data?: unknown
  next?: string | null
}

export async function runCrawlJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  const payload = job.payload as CrawlPayload
  if (!payload?.sourceId || typeof payload.url !== 'string') {
    throw new Error('crawl-source needs { sourceId, url }')
  }
  const url = normalizeSourceUrl(payload.url)
  const records = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const setSource = (patch: Partial<Source>) => records.records.update('sources', payload.sourceId, patch)
  const state = job.resumeFrom as CrawlState | undefined

  try {
    if (!state && payload.resumeCrawlId) {
      // Rebuild the index from a crawl that already finished — no new charge.
      await setSource({ status: 'indexing', statusMessage: 'Rebuilding the index from the last crawl', crawlId: payload.resumeCrawlId })
      const generation = `${payload.resumeCrawlId}.r${Date.now().toString(36)}`
      ctx.continue(
        { phase: 'add', next: 0, firecrawlJobId: payload.resumeCrawlId, generation, costUsd: 0 } satisfies CrawlState,
        { afterMs: 100 },
      )
      return
    }

    if (!state) {
      const started = (await records.integrations.call('firecrawl/crawl', {
        url,
        limit: clampPageLimit(payload.pageLimit),
        ...(payload.includePaths?.length ? { includePaths: payload.includePaths } : {}),
        excludePaths: DEFAULT_EXCLUDE_PATHS,
        formats: ['markdown'],
        onlyMainContent: true,
      })) as { jobId: string }
      await setSource({ status: 'crawling', statusMessage: 'Crawl started', crawlId: started.jobId })
      ctx.progress(0.05, 'Crawl started')
      ctx.continue({ phase: 'poll', firecrawlJobId: started.jobId, startedAt: Date.now() }, { afterMs: POLL_MS })
      return
    }

    if (state.phase === 'poll') {
      if (Date.now() - state.startedAt > CRAWL_DEADLINE_MS) {
        throw new Error('Crawl did not finish within 10 minutes')
      }
      const crawl = await getCrawl(records, state.firecrawlJobId)
      if (crawl.status !== 'completed') {
        const done = crawl.completed ?? 0
        const total = crawl.total ?? 0
        const message = total ? `Crawling ${done}/${total} pages` : 'Crawling'
        ctx.progress(0.05 + 0.45 * (total ? done / total : 0), message)
        await setSource({ statusMessage: message })
        ctx.continue(state, { afterMs: POLL_MS })
        return
      }
      const pages = extractPages(crawl.data)
      if (pages.length === 0) throw new Error('Crawl finished but returned no readable pages')
      // get-crawl pages its result past ~10 MB; a capped docs crawl stays far below,
      // so a `next` cursor means something unexpected — record it, don't hide it.
      const note = crawl.next ? 'Firecrawl returned a partial page list; some pages were skipped' : undefined
      await setSource({ status: 'indexing', statusMessage: `Indexing ${pages.length} pages`, pageCount: pages.length })
      ctx.continue(
        {
          phase: 'add',
          next: 0,
          firecrawlJobId: state.firecrawlJobId,
          generation: state.firecrawlJobId,
          costUsd: crawl.costUsd ?? 0,
          note,
        } satisfies CrawlState,
        { afterMs: 100 },
      )
      return
    }

    if (state.phase === 'add') {
      const pages = extractPages((await getCrawl(records, state.firecrawlJobId)).data)
      const written = new Set(
        (await sourceRows(records, payload.sourceId))
          .filter((r) => r.data.crawlId === state.generation)
          .map((r) => r.data.pageKey),
      )
      const batch = pages.slice(state.next, state.next + ADD_BATCH)
      await addPages(env, records, payload.sourceId, state.generation, batch, written, ctx)
      const next = state.next + batch.length
      ctx.progress(0.5 + 0.4 * (next / pages.length), `Indexed ${next}/${pages.length} pages`)
      await setSource({ statusMessage: `Indexed ${next}/${pages.length} pages`, pageCount: pages.length })
      if (next < pages.length) {
        ctx.continue({ ...state, next } satisfies CrawlState, { afterMs: 100 })
      } else {
        ctx.continue(
          { ...state, phase: 'index', startedAt: Date.now(), pageCount: pages.length } satisfies CrawlState,
          { afterMs: INDEX_POLL_MS },
        )
      }
      return
    }

    if (state.phase === 'index') {
      // Wait until this generation's folder has finished indexing.
      const folder = knowledgeFolderFor(payload.sourceId, state.generation)
      const items = await listKnowledgeItems(env, folder)
      const pending = items.filter((i) => i.status === 'queued' || i.status === 'running').length
      const errored = items.filter((i) => i.status === 'error').length
      const timedOut = Date.now() - state.startedAt > INDEX_DEADLINE_MS

      if (pending > 0 && !timedOut) {
        ctx.progress(0.9, `Indexing — ${pending} of ${items.length} sections still queued`)
        await setSource({ statusMessage: `Indexing — ${pending} of ${items.length} sections still queued` })
        ctx.continue(state, { afterMs: INDEX_POLL_MS })
        return
      }

      const notes = [
        state.note,
        errored ? `${errored} sections failed to index` : undefined,
        pending ? `${pending} sections were still indexing after 30 minutes` : undefined,
      ].filter(Boolean)
      // Switch searches to the new generation, then clean up the old one.
      await setSource({
        status: 'ready',
        statusMessage: notes.length ? notes.join('; ') : `${state.pageCount} pages indexed (${items.length} sections)`,
        lastCrawledAt: new Date().toISOString(),
        costUsd: state.costUsd,
        indexFolder: folder,
      })
      ctx.continue({ ...state, phase: 'cleanup' } satisfies CrawlState, { afterMs: 100 })
      return
    }

    // phase === 'cleanup': remove rows (and knowledge items) from older generations.
    const old = (await sourceRows(records, payload.sourceId)).filter((r) => r.data.crawlId !== state.generation)
    if (old.length === 0) return { generation: state.generation, costUsd: state.costUsd }
    const kb = knowledge(env)
    for (const row of old.slice(0, REMOVE_BATCH)) {
      for (const itemId of row.data.knowledgeItemIds ?? []) await kb.remove(itemId).catch(() => {}) // already gone is fine
      await records.records.delete('doc_pages', row.recordId)
    }
    ctx.progress(1, `Cleaning up the previous index (${Math.max(old.length - REMOVE_BATCH, 0)} pages left)`)
    ctx.continue(state, { afterMs: 100 })
    return
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setSource({ status: 'failed', statusMessage: message }).catch(() => {})
    throw err
  }
}

type OwnerContext = ReturnType<typeof buildCronContext>

/** `kb.list` returns at most 50 items per page; a source can have more. */
async function listKnowledgeItems(env: Env, folder: string) {
  const kb = knowledge(env)
  const items = []
  for (let page = 1; page <= 10; page++) {
    const listed = await kb.list({ folder, page, perPage: 50 })
    items.push(...listed.items)
    if (listed.items.length < 50 || (listed.totalPages != null && page >= listed.totalPages)) break
  }
  return items
}

type PageRow = { recordId: string; data: DocPage }

async function sourceRows(owner: OwnerContext, sourceId: string): Promise<PageRow[]> {
  return (await owner.records.query('doc_pages', { where: { sourceId }, limit: 500 })) as PageRow[]
}

async function getCrawl(owner: OwnerContext, jobId: string): Promise<GetCrawlResult> {
  const crawl = (await owner.integrations.call('firecrawl/get-crawl', { jobId })) as GetCrawlResult
  if (crawl.status === 'failed' || crawl.status === 'cancelled') {
    throw new Error(`Firecrawl reported the crawl ${crawl.status}`)
  }
  return crawl
}

/** Index one batch of pages, skipping any this crawl already wrote. */
async function addPages(
  env: Env,
  owner: OwnerContext,
  sourceId: string,
  generation: string,
  pages: CrawledPage[],
  written: Set<string>,
  ctx: JobContext,
): Promise<void> {
  const kb = knowledge(env)
  const folder = knowledgeFolderFor(sourceId, generation)
  for (const page of pages) {
    if (ctx.signal.aborted) throw new Error('Canceled')
    const pageKey = await pageKeyFor(page.url)
    if (written.has(pageKey)) continue
    const itemIds: string[] = []
    for (const [n, section] of splitIntoSections(page.title, page.markdown).entries()) {
      const added = await kb.add(new File([section], `${pageKey}--s${n}.md`, { type: 'text/markdown' }), { folder })
      itemIds.push(...added.items.map((item) => item.id))
    }
    await owner.records.create('doc_pages', {
      sourceId,
      url: page.url,
      title: page.title,
      pageKey,
      contentHash: await sha256Hex(page.markdown),
      chars: page.markdown.length,
      knowledgeItemIds: itemIds,
      crawledAt: new Date().toISOString(),
      crawlId: generation,
    } satisfies DocPage)
  }
}
