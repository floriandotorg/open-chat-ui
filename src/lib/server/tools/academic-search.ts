import { searchEuropePmc } from './europepmc'
import { searchOpenAlex } from './openalex'
import type { ToolContext, ToolDefinition } from './types'

export interface AcademicResult {
  doi: string | null
  title: string
  year: string | null
  citedByCount: number
  authors: string
  url: string
  abstract: string | null
  source: 'OpenAlex' | 'Europe PMC'
}

export const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.max(lo, Math.min(hi, Math.floor(x)))
}

export const normalizeDoi = (raw: unknown): string | null => {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!v) return null
  const stripped = v.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '')
  return /^\d+\.\d+\/[^/\s].*$/i.test(stripped) ? stripped : null
}

export const normalizeTitle = (raw: unknown): string =>
  String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const dedupResults = (results: AcademicResult[], limit: number): AcademicResult[] => {
  const byDoi = new Map<string, number>()
  const byTitle = new Map<string, number>()
  const out: AcademicResult[] = []
  for (const r of results) {
    const doi = normalizeDoi(r.doi)
    const titleKey = normalizeTitle(r.title)
    let idx = doi ? (byDoi.get(doi) ?? -1) : -1
    if (idx === -1 && titleKey) idx = byTitle.get(titleKey) ?? -1
    if (idx === -1) {
      if (doi) byDoi.set(doi, out.length)
      if (titleKey) byTitle.set(titleKey, out.length)
      if (r.doi !== doi) r.doi = doi
      out.push(r)
      continue
    }
    const existing = out[idx]
    if (r.citedByCount > existing.citedByCount) existing.citedByCount = r.citedByCount
    if (!existing.abstract && r.abstract) existing.abstract = r.abstract
    if ((!existing.authors || existing.authors === 'Unknown authors') && r.authors && r.authors !== 'Unknown authors') {
      existing.authors = r.authors
    }
    if (!existing.url && r.url) existing.url = r.url
    if (!existing.year && r.year) existing.year = r.year
    const sources = new Set(existing.source.split(' + '))
    sources.add(r.source)
    existing.source = [...sources].join(' + ') as AcademicResult['source']
  }
  return out.slice(0, limit)
}

const yearOf = (r: AcademicResult): number => {
  const y = Number.parseInt(String(r.year ?? ''), 10)
  return Number.isFinite(y) ? y : -1
}

const sortMerged = (results: AcademicResult[], sort: string): AcademicResult[] => {
  if (sort === 'cited_by_count') return [...results].sort((a, b) => b.citedByCount - a.citedByCount)
  if (sort === 'publication_date') return [...results].sort((a, b) => yearOf(b) - yearOf(a))
  return results
}

const render = (query: string, filterDesc: string, results: AcademicResult[], hitCount: number, warnings: string[]): string => {
  const lines = results.map((r, i) => {
    const n = i + 1
    return `${n}. [${r.title || 'Untitled'}](${r.url || ''}) — ${r.year ?? 'n.d.'} — cited by ${r.citedByCount} — ${r.authors || 'Unknown authors'} — ${r.source}\n   ${r.abstract ?? 'No abstract available.'}`
  })
  const header = `# Academic search: "${query}"${filterDesc ? ` (filter: ${filterDesc})` : ''}\n\n${hitCount} results, showing ${lines.length} (deduplicated):\n`
  return header + lines.join('\n') + (warnings.length ? `\n\n${warnings.join('\n')}` : '')
}

export const academicSearch: ToolDefinition = {
  name: 'academic_search',
  description: `Search academic literature (papers/studies) by keywords across both OpenAlex (250M+ works) and Europe PMC (life-science/biomedical, 40M+ citations), then deduplicate by DOI/title. Returns markdown listing each work with title, year, URL, cited_by_count, authors, source, and the full abstract. No API key required.

Use for scholarly/scientific research questions, literature reviews, or to ground claims in peer-reviewed sources. Refine with from_year/to_year, min_citations, or open_access. Sort by relevance (default), cited_by_count, or publication_date.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keywords to search for in titles, abstracts, and full text.',
      },
      from_year: {
        type: 'integer',
        description: 'Earliest publication year (inclusive).',
      },
      to_year: {
        type: 'integer',
        description: 'Latest publication year (inclusive).',
      },
      min_citations: {
        type: 'integer',
        description: 'Minimum number of citations.',
      },
      open_access: {
        type: 'boolean',
        description: 'Restrict to open-access works only.',
      },
      sort: {
        type: 'string',
        description: 'Sort order: "relevance" (default), "cited_by_count", or "publication_date".',
      },
      limit: {
        type: 'integer',
        description: 'Number of results to return after dedup (1-25, default 5).',
      },
    },
    required: ['query'],
  },
  execute: async (args, context: ToolContext) => {
    const query = String(args.query ?? '').trim()
    if (!query) return 'Error: "query" is required.'

    const limit = clamp(args.limit, 1, 25, 5)
    const sort = String(args.sort ?? '').trim()
    const validSort = sort === 'cited_by_count' || sort === 'publication_date' ? sort : ''

    const filterParts: string[] = []
    if (typeof args.from_year === 'number') filterParts.push(`from_year=${args.from_year}`)
    if (typeof args.to_year === 'number') filterParts.push(`to_year=${args.to_year}`)
    if (typeof args.min_citations === 'number') filterParts.push(`min_citations=${args.min_citations}`)
    if (typeof args.open_access === 'boolean') filterParts.push(`open_access=${args.open_access}`)
    const filterDesc = filterParts.join(',')

    const settled = await Promise.allSettled([searchOpenAlex(args, context, limit, validSort), searchEuropePmc(args, context, limit, validSort)])

    const warnings: string[] = []
    let merged: AcademicResult[] = []
    let hitCount = 0
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        merged = merged.concat(r.value.results)
        hitCount += r.value.hitCount
      } else {
        warnings.push(`Warning: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
      }
    }

    const deduped = dedupResults(merged, limit)
    const ordered = sortMerged(deduped, validSort)
    return render(query, filterDesc, ordered, hitCount, warnings)
  },
}
