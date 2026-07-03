import type { ToolDefinition } from './types'

interface BraveNewsResult {
  title?: string
  url?: string
  description?: string
  age?: string
  page_age?: string
  meta_url?: { hostname?: string }
}

interface BraveNewsResponse {
  results?: BraveNewsResult[]
}

const stripHtml = (s: string): string =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export const braveNewsSearch: ToolDefinition = {
  name: 'news_search',
  description: 'Search for recent news articles on any topic using the Brave News search engine. Use this when you need current news, recent events, press coverage, or time-sensitive reporting.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The news search query',
      },
      limit: {
        type: 'integer',
        description: 'Number of news results to return (1-50, default 10)',
      },
      offset: {
        type: 'integer',
        description: 'Number of results to skip for pagination (default 0)',
      },
      country: {
        type: 'string',
        description: 'Two-letter country code for regional news (e.g. "us", "de", "fr", "gb"). Defaults to none.',
      },
    },
    required: ['query'],
  },
  execute: async (args, context) => {
    const apiKey = await context.getApiKey('brave')
    if (!apiKey) {
      return 'Error: No Brave Search API key configured. Please add your Brave Search API key in Settings > Tools.'
    }

    const query = args.query as string
    const limit = Math.min(50, Math.max(1, (args.limit as number) ?? 10))
    const offset = Math.max(0, (args.offset as number) ?? 0)
    const country = (args.country as string | undefined)?.trim().toLowerCase() || undefined

    const params = new URLSearchParams({
      q: query,
      count: String(limit),
      safesearch: 'off',
    })
    if (country) params.set('country', country)
    if (offset > 0) params.set('offset', String(offset))

    const url = `https://api.search.brave.com/res/v1/news/search?${params.toString()}`

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return `Error: Brave news search failed (HTTP ${response.status}). ${body}`
    }

    const data = (await response.json()) as BraveNewsResponse
    const results = data.results ?? []

    if (results.length === 0) return 'No news results found.'

    const formatted = results
      .map((r, n) => {
        const title = r.title ? stripHtml(r.title) : ''
        const urlStr = r.url ?? ''
        const desc = r.description ? stripHtml(r.description) : ''
        const age = r.age ? ` _(${r.age})_` : ''
        const snippet = desc ? `\n  ${desc}` : ''
        return `${n + 1}. [${title}](${urlStr})${age}${snippet}`
      })
      .join('\n')

    return `## News Results\n${formatted}`
  },
}
