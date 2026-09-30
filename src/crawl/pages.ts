/**
 * Pure helpers for the crawl job — no I/O, so they are unit-tested directly
 * (src/crawl/pages.test.ts).
 */

/** Hard ceiling on pages per crawl. The owner pays per page, so the job
 *  clamps whatever the payload asks for. */
export const MAX_PAGES_PER_CRAWL = 75

export function clampPageLimit(requested: unknown): number {
  const n = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : MAX_PAGES_PER_CRAWL
  return Math.min(Math.max(n, 1), MAX_PAGES_PER_CRAWL)
}

/** Accepts only absolute http(s) URLs; returns the normalized origin + path. */
export function normalizeSourceUrl(raw: string): string {
  const url = new URL(raw.trim())
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Only http(s) URLs can be crawled, got ${url.protocol}`)
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

export interface CrawledPage {
  url: string
  title: string
  markdown: string
}

/**
 * Firecrawl's get-crawl `data` is an array of `{ markdown, metadata }`. The
 * catalog leaves it untyped, so read it defensively and drop pages that
 * failed upstream (non-2xx) or came back empty.
 */
export function extractPages(data: unknown): CrawledPage[] {
  if (!Array.isArray(data)) return []
  const seen = new Set<string>()
  const pages: CrawledPage[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const { markdown, metadata } = item as { markdown?: unknown; metadata?: Record<string, unknown> }
    if (typeof markdown !== 'string' || markdown.trim().length === 0) continue
    const status = metadata?.statusCode
    if (typeof status === 'number' && (status < 200 || status >= 300)) continue
    const url = [metadata?.sourceURL, metadata?.url].find((u): u is string => typeof u === 'string')
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = typeof metadata?.title === 'string' && metadata.title.trim() ? metadata.title.trim() : url
    pages.push({ url, title, markdown })
  }
  return pages
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Short, filesystem-safe key for a page URL — used as the knowledge-base
 *  filename, so a search hit maps back to its doc_pages row. */
export async function pageKeyFor(url: string): Promise<string> {
  return (await sha256Hex(url)).slice(0, 20)
}

/** Knowledge-base folder for one source. Record ids are `[0-9a-z-]`. */
export function knowledgeFolderFor(sourceId: string): string {
  return `sources/${sourceId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}
