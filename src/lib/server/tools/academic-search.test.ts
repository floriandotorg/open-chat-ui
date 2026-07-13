import { type AcademicResult, dedupResults, normalizeDoi, normalizeTitle } from './academic-search'
import { describe, expect, it } from 'vitest'

const mk = (over: Partial<AcademicResult> = {}): AcademicResult => ({
  doi: null,
  title: 'Untitled',
  year: null,
  citedByCount: 0,
  authors: 'Unknown authors',
  url: '',
  abstract: null,
  source: 'OpenAlex',
  ...over,
})

describe('normalizeDoi', () => {
  it('lowercases and strips URL prefixes', () => {
    expect(normalizeDoi('https://doi.org/10.1186/S13059-014-0550-8')).toBe('10.1186/s13059-014-0550-8')
    expect(normalizeDoi('DOI:10.1186/S13059-014-0550-8')).toBe('10.1186/s13059-014-0550-8')
    expect(normalizeDoi('10.1186/s13059-014-0550-8')).toBe('10.1186/s13059-014-0550-8')
  })
  it('returns null for blank / non-doi junk', () => {
    expect(normalizeDoi(null)).toBeNull()
    expect(normalizeDoi('')).toBeNull()
    expect(normalizeDoi('not-a-doi')).toBeNull()
  })
})

describe('normalizeTitle', () => {
  it('collapses case, punctuation and whitespace', () => {
    expect(normalizeTitle('CRISPR Cas9: A  Review!')).toBe('crispr cas9 a review')
    expect(normalizeTitle('  Hello   World  ')).toBe('hello world')
  })
})

describe('dedupResults', () => {
  it('dedups by DOI, keeping the higher citation count and merging fields', () => {
    const a = mk({ doi: '10.1/a', title: 'Alpha', citedByCount: 5, abstract: 'from openalex', source: 'OpenAlex' })
    const b = mk({ doi: '10.1/A', title: 'Alpha (dup)', citedByCount: 12, abstract: null, source: 'Europe PMC', url: 'https://x' })
    const out = dedupResults([a, b], 10)
    expect(out).toHaveLength(1)
    expect(out[0].citedByCount).toBe(12)
    expect(out[0].abstract).toBe('from openalex')
    expect(out[0].source).toBe('OpenAlex + Europe PMC')
  })

  it('falls back to title matching when DOI is missing', () => {
    const a = mk({ doi: null, title: 'CRISPR Cas9 revolutionizing genetic engineering', source: 'OpenAlex' })
    const b = mk({ doi: null, title: 'crispr cas9 revolutionizing genetic engineering.', source: 'Europe PMC' })
    expect(dedupResults([a, b], 10)).toHaveLength(1)
  })

  it('does not collapse distinct titles', () => {
    const a = mk({ title: 'One' })
    const b = mk({ title: 'Two' })
    expect(dedupResults([a, b], 10)).toHaveLength(2)
  })

  it('respects the limit after dedup', () => {
    const items = Array.from({ length: 5 }, (_, i) => mk({ title: `T${i}` }))
    expect(dedupResults(items, 3)).toHaveLength(3)
  })

  it('fills a missing abstract from the duplicate', () => {
    const a = mk({ doi: '10.1/a', title: 'Alpha', abstract: null, source: 'OpenAlex' })
    const b = mk({ doi: '10.1/a', title: 'Alpha', abstract: 'from epmc', source: 'Europe PMC' })
    expect(dedupResults([a, b], 10)[0].abstract).toBe('from epmc')
  })
})
