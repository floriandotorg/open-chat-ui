import type { ToolDefinition } from './types'

interface KagiSearchResult {
  t: number
  url?: string
  title?: string
  snippet?: string
  published?: string
}

export const kagiSearch: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information on any topic using the Kagi search engine. Use this when you need up-to-date information, facts, news, or anything that might have changed after your training cutoff.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      limit: {
        type: 'integer',
        description: 'Number of results to return (1-20, default 5)',
      },
    },
    required: ['query'],
  },
  execute: async (args, context) => {
    const apiKey = await context.getApiKey('kagi')
    if (!apiKey) {
      return 'Error: No Kagi API key configured. Please add your Kagi API key in Settings > Tools.'
    }

    const query = args.query as string
    const limit = Math.min(20, Math.max(1, (args.limit as number) ?? 5))

    const url = `https://kagi.com/api/v0/search?q=${encodeURIComponent(query)}&limit=${limit}`

    const response = await fetch(url, {
      headers: { Authorization: `Bot ${apiKey}` },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return `Error: Kagi search failed (HTTP ${response.status}). ${body}`
    }

    const data = (await response.json()) as { data: KagiSearchResult[] }
    const results = data.data
      ?.filter(r => r.t === 0)
      ?.slice(0, limit)
      ?.map((r, n) => {
        const snippet = r.snippet ? ` - ${r.snippet}` : ''
        return `${n + 1}. [${r.title}](${r.url})${snippet}`
      })
      ?.join('\n')

    return results || 'No results found.'
  },
}
