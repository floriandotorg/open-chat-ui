import type { ToolDefinition } from './types'
import Exa from 'exa-js'

const CATEGORIES = ['company', 'people', 'research paper', 'news', 'personal site', 'financial report'] as const
type Category = (typeof CATEGORIES)[number]

const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v)

interface ExaResult {
  title: string | null
  url: string
  publishedDate?: string
  author?: string
  score?: number
  highlights?: string[]
}

interface ExaSearchResponse {
  results: ExaResult[]
  resolvedSearchType?: string
  autoDate?: string
}

const formatResult = (r: ExaResult, n: number): string => {
  const title = r.title ?? '(untitled)'
  const date = r.publishedDate ? ` _(${r.publishedDate.slice(0, 10)})_` : ''
  const author = r.author ? ` · ${r.author}` : ''
  const highlights = (r.highlights ?? []).slice(0, 3)
  const snippet = highlights.length > 0 ? `\n  > ${highlights.join('\n  > ')}` : ''
  return `${n}. [${title}](${r.url})${date}${author}${snippet}`
}

export const exaSearch: ToolDefinition = {
  name: 'semantic_web_search',
  description: [
    'Semantic web search over the full web using Exa — a neural search engine that understands natural-language queries and returns the most semantically relevant pages.',
    'A complementary source to web_search (keyword search): Exa matches concepts rather than exact keywords, so it surfaces pages keyword search misses. Per the system rules, always call both together in the same turn for any web research.',
    'The query should be a natural-language description of what you want, not keyword tokens. Longer, semantically rich queries work better than short ones.',
    'Optionally narrow with a category to focus on a content type. Category examples:',
    '- company: Profitable AI infrastructure startups founded after 2022',
    '- people: ML researchers leading post-training work at frontier AI labs',
    '- research paper: Recent papers on long-context retrieval-augmented generation',
    '- news: Latest news on US-China AI chip export restrictions',
    '- personal site: Blog posts about building with local LLMs',
    '- financial report: AI infrastructure companies with strong gross margins in 2024',
    'Note: the "company" and "people" categories do not support date filters.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A natural-language description of what you are looking for. Semantically rich queries work best (e.g. "Profitable AI infrastructure startups founded after 2022").',
      },
      numResults: {
        type: 'integer',
        description: 'Number of results to return (1-100, default 10).',
      },
      category: {
        type: 'string',
        description: 'Focus the search on a content type. Omit for a general web search.',
        enum: [...CATEGORIES],
      },
      startPublishedDate: {
        type: 'string',
        description: 'ISO 8601 date (e.g. "2024-01-01"). Only return pages published after this date. Not supported for the "company" or "people" categories.',
      },
      endPublishedDate: {
        type: 'string',
        description: 'ISO 8601 date (e.g. "2024-12-31"). Only return pages published before this date. Not supported for the "company" or "people" categories.',
      },
    },
    required: ['query'],
  },
  execute: async (args, context) => {
    const apiKey = await context.getApiKey('exa')
    if (!apiKey) {
      return 'Error: No Exa API key configured. Please add your Exa API key in Settings > Tools.'
    }

    const query = String(args.query ?? '').trim()
    if (!query) return 'Error: "query" is required.'

    const numResults = Math.min(100, Math.max(1, (args.numResults as number) ?? 10))
    const categoryRaw = (args.category as string | undefined)?.trim().toLowerCase()
    const category = categoryRaw && isCategory(categoryRaw) ? categoryRaw : undefined
    const startPublishedDate = (args.startPublishedDate as string | undefined)?.trim() || undefined
    const endPublishedDate = (args.endPublishedDate as string | undefined)?.trim() || undefined

    if ((startPublishedDate || endPublishedDate) && (category === 'company' || category === 'people')) {
      return 'Error: The "company" and "people" categories do not support startPublishedDate or endPublishedDate. Drop the date filters or pick a different category.'
    }

    const client = new Exa(apiKey)

    let data: ExaSearchResponse
    try {
      data = (await client.search(query, {
        type: 'auto',
        numResults,
        category,
        startPublishedDate,
        endPublishedDate,
        contents: { highlights: true },
      })) as ExaSearchResponse
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Error: Exa search failed. ${msg}`
    }

    const results = data.results ?? []
    if (results.length === 0) return 'No results found.'

    const resolved = data.resolvedSearchType ? ` _(search type: ${data.resolvedSearchType})_` : ''
    const header = `## Semantic Web Results${resolved}`
    return `${header}\n${results.map((r, n) => formatResult(r, n + 1)).join('\n')}`
  },
}
