import { type AcademicResult, clamp, normalizeDoi } from './academic-search'
import type { ToolContext } from './types'

const BASE_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const TIMEOUT_MS = 20_000

const buildQuery = (args: Record<string, unknown>): string => {
  const base = String(args.query ?? '').trim()
  const parts = [`(${base})`]
  const fromYear = typeof args.from_year === 'number' ? args.from_year : null
  const toYear = typeof args.to_year === 'number' ? args.to_year : null
  if (fromYear != null && toYear != null) parts.push(`FIRST_PDATE:[${fromYear}-01-01 TO ${toYear}-12-31]`)
  else if (fromYear != null) parts.push(`FIRST_PDATE:[${fromYear}-01-01 TO 3000-12-31]`)
  else if (toYear != null) parts.push(`FIRST_PDATE:[0001-01-01 TO ${toYear}-12-31]`)
  if (args.open_access === true) parts.push('OPEN_ACCESS:y')
  return parts.join(' AND ')
}

export const searchEuropePmc = async (args: Record<string, unknown>, _context: ToolContext, limit: number, sort: string): Promise<{ results: AcademicResult[]; hitCount: number }> => {
  const query = buildQuery(args)
  if (!query) return { results: [], hitCount: 0 }

  const qs = new URLSearchParams({
    query,
    format: 'json',
    resultType: 'core',
    pageSize: String(clamp(limit, 1, 100, limit)),
  })
  if (sort === 'cited_by_count') qs.set('sort', 'CITED desc')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}?${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'open-chat-ui/1.0' },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}: ${text.slice(0, 200)}`)
    const data = JSON.parse(text) as {
      hitCount?: number
      resultList?: { result?: Record<string, unknown>[] }
    }

    const minCitations = typeof args.min_citations === 'number' ? args.min_citations : null
    const results: AcademicResult[] = []
    for (const r of data.resultList?.result ?? []) {
      const cited = Number.parseInt(String(r.citedByCount ?? '0'), 10)
      if (!Number.isFinite(cited)) continue
      if (minCitations != null && cited < minCitations) continue
      const doi = normalizeDoi(r.doi)
      const pmid = r.pmid ? String(r.pmid) : null
      const pmcid = r.pmcid ? String(r.pmcid) : null
      const url = doi ? `https://doi.org/${doi}` : pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : pmid ? `https://europepmc.org/article/MED/${pmid}` : ''
      const authors = String(r.authorString ?? '')
        .trim()
        .replace(/\.$/, '')
      results.push({
        doi,
        title: String(r.title ?? 'Untitled'),
        year: r.pubYear ? String(r.pubYear) : null,
        citedByCount: cited,
        authors: authors || 'Unknown authors',
        url,
        abstract: r.abstractText ? String(r.abstractText) : null,
        source: 'Europe PMC',
      })
    }
    return { results, hitCount: data.hitCount ?? 0 }
  } finally {
    clearTimeout(timer)
  }
}
