import type { ToolContext, ToolDefinition } from './types'

const BASE_URL = 'https://api.openalex.org'
const TIMEOUT_MS = 20_000
const DEFAULT_LIMIT = 5
const MAX_PER_PAGE = 25

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

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.max(lo, Math.min(hi, Math.floor(x)))
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

export const academicSearch: ToolDefinition = {
  name: 'academic_search',
  description: `Search academic literature (papers/studies) by keywords using the OpenAlex API (250M+ works, free). Returns markdown listing each work with title, year, URL, cited_by_count, authors, and the full abstract. A free API key (optional, configured in settings) raises rate limits.

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
        description: 'Number of results to return (1-25, default 5).',
      },
    },
    required: ['query'],
  },
  execute: async (args, context: ToolContext) => {
    const query = String(args.query ?? '').trim()
    if (!query) return 'Error: "query" is required.'

    const filter = buildFilter(args)
    const limit = clamp(args.limit, 1, MAX_PER_PAGE, DEFAULT_LIMIT)
    const sort = String(args.sort ?? '').trim()
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
      if (!res.ok) return `Error: OpenAlex HTTP ${res.status}: ${text.slice(0, 300)}`
      const data = JSON.parse(text) as {
        meta?: { count?: number }
        results?: Record<string, unknown>[]
      }

      const lines: string[] = []
      for (const [i, w] of (data.results ?? []).entries()) {
        const authorships = Array.isArray(w.authorships) ? (w.authorships as { author?: { display_name?: string } }[]) : []
        const authors = authorships
          .slice(0, 5)
          .map(a => a.author?.display_name)
          .filter(Boolean)
          .join(', ')
        const oa = w.open_access as { oa_url?: string | null } | undefined
        const url = (w.doi as string | null) ?? oa?.oa_url ?? `https://openalex.org/${stripPrefix(w.id)}`
        const n = i + 1
        const abstract = reconstructAbstract(w.abstract_inverted_index as Record<string, number[]> | null | undefined)
        lines.push(`${n}. [${w.title ?? 'Untitled'}](${url ?? ''}) — ${w.publication_year ?? 'n.d.'} — cited by ${w.cited_by_count ?? 0} — ${authors || 'Unknown authors'}\n   ${abstract ?? 'No abstract available.'}`)
      }

      const header = `# Academic search: "${query}"${filter ? ` (filter: ${filter})` : ''}\n\n${data.meta?.count ?? 0} results, showing ${lines.length}:\n`
      return header + lines.join('\n')
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      clearTimeout(timer)
    }
  },
}
