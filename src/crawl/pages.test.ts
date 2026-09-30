import { describe, expect, it } from 'vitest'
import {
  MAX_PAGES_PER_CRAWL,
  clampPageLimit,
  extractPages,
  knowledgeFolderFor,
  normalizeSourceUrl,
  pageKeyFor,
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
