import { describe, expect, it } from 'vitest'
import {
  MAX_PAGES_PER_CRAWL,
  canonicalPageUrl,
  clampPageLimit,
  extractPages,
  knowledgeFolderFor,
  normalizeSourceUrl,
  pageKeyFor,
  pageKeyFromFilename,
  splitIntoSections,
} from './pages'

describe('clampPageLimit', () => {
  it('never exceeds the per-crawl budget cap', () => {
    expect(clampPageLimit(1000)).toBe(MAX_PAGES_PER_CRAWL)
    expect(clampPageLimit(undefined)).toBe(MAX_PAGES_PER_CRAWL)
    expect(clampPageLimit('999')).toBe(MAX_PAGES_PER_CRAWL)
  })
  it('keeps at least one page and floors fractions', () => {
    expect(clampPageLimit(0)).toBe(1)
    expect(clampPageLimit(-5)).toBe(1)
    expect(clampPageLimit(12.9)).toBe(12)
  })
})

describe('normalizeSourceUrl', () => {
  it('strips hash, query and trailing slash', () => {
    expect(normalizeSourceUrl(' https://docs.deep.space/?ref=x#top ')).toBe('https://docs.deep.space')
    expect(normalizeSourceUrl('https://docs.deep.space/guides/')).toBe('https://docs.deep.space/guides')
  })
  it('rejects non-http schemes and garbage', () => {
    expect(() => normalizeSourceUrl('file:///etc/passwd')).toThrow(/http/)
    expect(() => normalizeSourceUrl('not a url')).toThrow()
  })
})

describe('extractPages', () => {
  it('keeps readable 2xx pages, dedupes by URL, falls back to URL as title', () => {
    const pages = extractPages([
      { markdown: '# A', metadata: { sourceURL: 'https://d/a', title: 'A', statusCode: 200 } },
      { markdown: '# A again', metadata: { sourceURL: 'https://d/a', statusCode: 200 } },
      { markdown: 'gone', metadata: { sourceURL: 'https://d/404', statusCode: 404 } },
      { markdown: '   ', metadata: { sourceURL: 'https://d/empty' } },
      { markdown: 'no title', metadata: { url: 'https://d/b' } },
      null,
      'junk',
    ])
    expect(pages).toEqual([
      { url: 'https://d/a', title: 'A', markdown: '# A' },
      { url: 'https://d/b', title: 'https://d/b', markdown: 'no title' },
    ])
  })
  it('collapses .md twins into their page and drops site files (seen in the docs.deep.space crawl)', () => {
    const page = (sourceURL: string, title?: string) => ({ markdown: `body of ${sourceURL}`, metadata: { sourceURL, title, statusCode: 200 } })
    const pages = extractPages([
      page('https://docs.deep.space/concepts/architecture.md'),
      page('https://docs.deep.space/concepts/architecture', 'Architecture'),
      page('https://docs.deep.space/index.md'),
      page('https://docs.deep.space/', 'Home'),
      page('https://docs.deep.space/sitemap.xml'),
      page('https://docs.deep.space/guides/testing.md'),
    ])
    expect(pages.map((p) => [p.url, p.title])).toEqual([
      ['https://docs.deep.space/concepts/architecture', 'Architecture'],
      ['https://docs.deep.space', 'Home'],
      // a twin with no HTML sibling is still the only copy of that page
      ['https://docs.deep.space/guides/testing', 'https://docs.deep.space/guides/testing'],
    ])
  })
  it('canonicalizes page URLs', () => {
    expect(canonicalPageUrl('https://docs.deep.space/guides/x/')).toBe('https://docs.deep.space/guides/x')
    expect(canonicalPageUrl('https://docs.deep.space/guides/x.mdx?y=1#z')).toBe('https://docs.deep.space/guides/x')
    expect(canonicalPageUrl('https://docs.deep.space/index.md')).toBe('https://docs.deep.space')
  })
  it('returns [] for a non-array payload', () => {
    expect(extractPages(undefined)).toEqual([])
    expect(extractPages({ data: [] })).toEqual([])
  })
})

describe('keys', () => {
  it('derives a stable 20-char hex page key', async () => {
    const a = await pageKeyFor('https://docs.deep.space/guides/background-jobs')
    expect(a).toMatch(/^[0-9a-f]{20}$/)
    expect(await pageKeyFor('https://docs.deep.space/guides/background-jobs')).toBe(a)
  })
  it('builds a folder from a record id, replacing unsafe characters', () => {
    expect(knowledgeFolderFor('1714000000000-k3f9x2a')).toBe('sources/1714000000000-k3f9x2a')
    expect(knowledgeFolderFor('a/../b')).toBe('sources/a____b')
  })
})

describe('splitIntoSections', () => {
  const page = [
    '# Managed knowledge',
    'Upload and search an app-owned AI Search knowledge base. '.repeat(5),
    '## API',
    'Call kb.add and kb.search from the worker. '.repeat(8),
    '## Limits and validation',
    '* `mode` is `hybrid`, `semantic`, or `fulltext`.',
    '## Pricing',
    'DeepSpace credits use 100 credits per US dollar. '.repeat(6),
  ].join('\n')

  it('gives each heading its own labelled section, merging ones too small to stand alone', () => {
    const sections = splitIntoSections('Managed knowledge', page)
    expect(sections[0]).toMatch(/^Managed knowledge › Managed knowledge\n/)
    // "Limits and validation" is one line, so it merges into the next section.
    const limits = sections.find((s) => s.includes('`mode` is `hybrid`'))!
    expect(limits).toContain('Pricing')
    expect(limits).toContain('100 credits per US dollar')
    expect(sections.every((s) => s.length <= 1800 + 80)).toBe(true)
  })

  it('splits an oversized section at paragraph breaks', () => {
    const long = ['## Big', ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i} `.repeat(30))].join('\n\n')
    const sections = splitIntoSections('T', long, 1000)
    expect(sections.length).toBeGreaterThan(3)
    expect(sections.every((s) => s.startsWith('T › Big\n'))).toBe(true)
  })

  it('falls back to the whole page when there is nothing to split', () => {
    expect(splitIntoSections('T', 'Just a line.')).toEqual(['T\n\nJust a line.'])
  })
})

describe('index folders and section filenames', () => {
  it('scopes each crawl generation to its own folder', () => {
    expect(knowledgeFolderFor('src1', 'f5b2-9a')).toBe('sources/src1/f5b2-9a')
    expect(knowledgeFolderFor('src1')).toBe('sources/src1')
  })
  it('maps section and legacy filenames back to the page key', () => {
    expect(pageKeyFromFilename('sources/a/b/0123456789abcdef0123--s3.md')).toBe('0123456789abcdef0123')
    expect(pageKeyFromFilename('0123456789abcdef0123.md')).toBe('0123456789abcdef0123')
  })
})
