import type { AcademicResult } from './academic-search'
import type { ToolContext } from './types'

const BASE_URL = 'https://api.openalex.org'
const TIMEOUT_MS = 20_000
const stripPrefix = (id: unknown): string =>
  String(id ?? '')
    .trim()
    .replace(/^https?:\/\/openalex\.org\//i, '')

const reconstructAbstract = (inverted: Record<string, number[]> | null | undefined): string | null => {
  if (!inverted) return null
  const positions: { pos: number; word: string }[] = []
  for (const [word, posList] of Object.entries(inverted)) {
    if (!Array.isArray(posList)) continue
    for (const p of posList) positions.push({ pos: p, word })
  }
  if (!positions.length) return null
  positions.sort((a, b) => a.pos - b.pos)
  return positions.map(p => p.word).join(' ')
}

export const openAlexAuthParams = (value: string | null): { mailto?: string; api_key?: string } => {
  const v = value?.trim()
  if (!v) return {}
  if (v.includes('@')) return { mailto: v }
  return { api_key: v }
}

const buildFilter = (args: Record<string, unknown>): string => {
  const parts: string[] = []
  const fromYear = typeof args.from_year === 'number' ? args.from_year : null
  const toYear = typeof args.to_year === 'number' ? args.to_year : null
  if (fromYear != null && toYear != null) parts.push(`publication_year:${fromYear}-${toYear}`)
  else if (fromYear != null) parts.push(`publication_year:>${fromYear - 1}`)
  else if (toYear != null) parts.push(`publication_year:<${toYear + 1}`)

  const minCitations = typeof args.min_citations === 'number' ? args.min_citations : null
  if (minCitations != null) parts.push(`cited_by_count:>${Math.max(0, minCitations - 1)}`)

  if (typeof args.open_access === 'boolean') parts.push(`is_oa:${args.open_access}`)

  return parts.join(',')
}

export const searchOpenAlex = async (args: Record<string, unknown>, context: ToolContext, limit: number, sort: string): Promise<{ results: AcademicResult[]; hitCount: number }> => {
  const query = String(args.query ?? '').trim()
  if (!query) return { results: [], hitCount: 0 }

  const filter = buildFilter(args)
  const sortParam = sort === 'cited_by_count' ? 'cited_by_count:desc' : sort === 'publication_date' ? 'publication_date:desc' : ''

  const qs = new URLSearchParams({
    search: query,
    per_page: String(limit),
    select: 'id,doi,title,publication_year,cited_by_count,authorships,open_access,abstract_inverted_index',
  })
  if (filter) qs.set('filter', filter)
  if (sortParam) qs.set('sort', sortParam)
  const authParams = openAlexAuthParams(await context.getApiKey('openalex'))
  for (const [k, v] of Object.entries(authParams)) qs.set(k, v)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}/works?${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'open-chat-ui/1.0' },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}: ${text.slice(0, 200)}`)
    const data = JSON.parse(text) as {
      meta?: { count?: number }
      results?: Record<string, unknown>[]
    }

    const results: AcademicResult[] = []
    for (const w of data.results ?? []) {
      const authorships = Array.isArray(w.authorships) ? (w.authorships as { author?: { display_name?: string } }[]) : []
      const authors = authorships
        .slice(0, 5)
        .map(a => a.author?.display_name)
        .filter(Boolean)
        .join(', ')
      const oa = w.open_access as { oa_url?: string | null } | undefined
      const doi = (w.doi as string | null) ?? null
      const url = doi ?? oa?.oa_url ?? `https://openalex.org/${stripPrefix(w.id)}`
      const abstract = reconstructAbstract(w.abstract_inverted_index as Record<string, number[]> | null | undefined)
      const cited = typeof w.cited_by_count === 'number' ? w.cited_by_count : 0
      results.push({
        doi,
        title: String(w.title ?? 'Untitled'),
        year: w.publication_year != null ? String(w.publication_year) : null,
        citedByCount: cited,
        authors: authors || 'Unknown authors',
        url: url ?? '',
        abstract,
        source: 'OpenAlex',
      })
    }
    return { results, hitCount: data.meta?.count ?? 0 }
  } finally {
    clearTimeout(timer)
  }
}
