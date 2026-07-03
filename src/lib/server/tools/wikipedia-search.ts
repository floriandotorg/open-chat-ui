import type { ToolDefinition } from './types'

interface WikipediaPage {
  key?: string
  title?: string
  excerpt?: string
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 50
const TIMEOUT_MS = 20_000

export const wikipediaSearch: ToolDefinition = {
  name: 'wikipedia_search',
  description: 'Search Wikipedia for encyclopedia articles on any topic. Returns the title, excerpt, and a link to each matching article. Use for factual background, definitions, biographies, history, and general-knowledge questions.',
  parameters: {
    type: 'object',
    properties: {
      lang: {
        type: 'string',
        description: 'Wikipedia language code (e.g. "en", "de", "fr", "es"). Defaults to "en".',
      },
      query: {
        type: 'string',
        description: 'The search query.',
      },
      limit: {
        type: 'integer',
        description: `Number of results to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
      },
    },
    required: ['lang', 'query'],
  },
  execute: async args => {
    const lang =
      String(args.lang ?? '')
        .trim()
        .toLowerCase() || 'en'
    const query = String(args.query ?? '').trim()
    if (!query) return 'Error: "query" is required.'

    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor((args.limit as number) ?? DEFAULT_LIMIT)))

    const url = `https://api.wikimedia.org/core/v1/wikipedia/${encodeURIComponent(lang)}/search/page?q=${encodeURIComponent(query)}&limit=${limit}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HelloEmail/1.0 (info@hello-email.com) node-fetch/3',
        },
        signal: controller.signal,
      })
      const text = await res.text()
      if (!res.ok) return `Error: Wikipedia search failed (HTTP ${res.status}). ${text.slice(0, 300)}`

      const data = JSON.parse(text) as { pages?: WikipediaPage[] }
      const pages = data.pages ?? []
      if (!pages.length) return 'No results found.'

      const lines = pages.slice(0, limit).map((p, n) => {
        const title = p.title ?? p.key ?? 'Untitled'
        const excerpt = p.excerpt ? ` - ${p.excerpt}` : ''
        const link = p.key ? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.key)}` : ''
        return `${n + 1}. [${title}](${link})${excerpt}`
      })

      return lines.join('\n')
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      clearTimeout(timer)
    }
  },
}
