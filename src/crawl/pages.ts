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

/** Firecrawl `excludePaths` regexes: machine-readable twins of docs pages
 *  (`/guides/x.md`) and site files (`/sitemap.xml`) would use up crawl slots
 *  and show up as duplicate evidence. */
export const DEFAULT_EXCLUDE_PATHS = ['.*\\.(md|mdx|xml|txt|json)$']

const NON_PAGE_FILE = /\.(xml|txt|json)$/i

/** One key per docs page: `/guides/x`, `/guides/x/` and `/guides/x.md` are
 *  the same page; `/index.md` is the site root. */
export function canonicalPageUrl(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\.mdx?$/i, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1')
  return url.toString().replace(/\/$/, '')
}

/**
 * Firecrawl's get-crawl `data` is an array of `{ markdown, metadata }`. The
 * catalog leaves it untyped, so read it defensively and drop pages that
 * failed upstream (non-2xx), came back empty, or are site files rather than
 * docs pages. Markdown twins collapse into their page, keeping the HTML
 * render's title when both were crawled.
 */
export function extractPages(data: unknown): CrawledPage[] {
  if (!Array.isArray(data)) return []
  const byUrl = new Map<string, CrawledPage & { fromMarkdownTwin: boolean }>()
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const { markdown, metadata } = item as { markdown?: unknown; metadata?: Record<string, unknown> }
    if (typeof markdown !== 'string' || markdown.trim().length === 0) continue
    const status = metadata?.statusCode
    if (typeof status === 'number' && (status < 200 || status >= 300)) continue
    const raw = [metadata?.sourceURL, metadata?.url].find((u): u is string => typeof u === 'string')
    if (!raw || NON_PAGE_FILE.test(new URL(raw).pathname)) continue
    const url = canonicalPageUrl(raw)
    const fromMarkdownTwin = /\.mdx?$/i.test(new URL(raw).pathname)
    const existing = byUrl.get(url)
    if (existing && (fromMarkdownTwin || !existing.fromMarkdownTwin)) continue
    const title = typeof metadata?.title === 'string' && metadata.title.trim() ? metadata.title.trim() : url
    byUrl.set(url, { url, title, markdown, fromMarkdownTwin })
  }
  return [...byUrl.values()].map(({ url, title, markdown }) => ({ url, title, markdown }))
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

const safeSegment = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_')

/**
 * Knowledge-base folder for one source. With a `generation` (the crawl id),
 * each rebuild writes to its own folder and searches switch over only once it
 * is indexed — the live index keeps serving during a rebuild. Without one, the
 * legacy single folder (indexes built before 2026-10-01).
 */
export function knowledgeFolderFor(sourceId: string, generation?: string): string {
  const base = `sources/${safeSegment(sourceId)}`
  return generation ? `${base}/${safeSegment(generation)}` : base
}

/** `<pageKey>.md` or `<pageKey>--s3.md` → `<pageKey>`. */
export function pageKeyFromFilename(filename: string): string {
  return (filename.split('/').pop() ?? '').replace(/\.md$/, '').split('--')[0]
}

export const SECTION_MAX_CHARS = 1800
const SECTION_MIN_CHARS = 200

/**
 * Split a page's markdown at its headings into small, single-topic sections,
 * each prefixed with "<page title> › <heading>" so it stands on its own in
 * search. The managed index otherwise stored whole pages as ~4,000-char
 * chunks spanning many topics, and narrow questions ("supports hybrid
 * search?") didn't clear the relevance cut-off (accuracy test, 2026-10-01).
 * Tiny sections merge into the next one; oversized ones split at paragraphs.
 */
export function splitIntoSections(title: string, markdown: string, maxChars = SECTION_MAX_CHARS): string[] {
  const blocks: Array<{ heading: string; body: string }> = []
  let current = { heading: '', body: '' }
  for (const line of markdown.split('\n')) {
    const h = /^#{1,4}\s+(.+)$/.exec(line)
    if (h) {
      if (current.body.trim() || current.heading) blocks.push(current)
      current = { heading: h[1].trim(), body: '' }
    } else {
      current.body += line + '\n'
    }
  }
  if (current.body.trim() || current.heading) blocks.push(current)

  // Merge sections too small to carry a topic into the following one.
  const merged: typeof blocks = []
  for (const b of blocks) {
    const prev = merged[merged.length - 1]
    if (prev && prev.body.trim().length < SECTION_MIN_CHARS) {
      prev.body += (b.heading ? `\n${b.heading}\n` : '') + b.body
    } else {
      merged.push({ ...b })
    }
  }

  const sections: string[] = []
  for (const b of merged) {
    const label = b.heading ? `${title} › ${b.heading}` : title
    const paragraphs = b.body.trim().split(/\n{2,}/)
    let chunk = ''
    for (const para of paragraphs) {
      if (chunk && chunk.length + para.length + 2 > maxChars) {
        sections.push(`${label}\n\n${chunk.trim()}`)
        chunk = ''
      }
      chunk += para + '\n\n'
    }
    if (chunk.trim()) sections.push(`${label}\n\n${chunk.trim()}`)
  }
  return sections.length ? sections : [`${title}\n\n${markdown.trim()}`]
}
