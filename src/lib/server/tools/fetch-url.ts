import type { ToolDefinition } from './types'

export const fetchUrl: ToolDefinition = {
  name: 'fetch_url',
  description: 'Fetch the content of a web page and convert it to clean, readable text. Use this when you need to read the contents of a specific URL the user has shared or referenced. Returns the page content in Markdown format.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the web page to fetch',
      },
    },
    required: ['url'],
  },
  execute: async (args, context) => {
    const apiKey = await context.getApiKey('jina')
    const url = args.url as string

    if (!url) {
      return 'Error: No URL provided.'
    }

    const readerUrl = `https://r.jina.ai/${url}`
    const headers: Record<string, string> = {
      Accept: 'text/plain',
    }

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetch(readerUrl, { headers })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return `Error: Failed to fetch URL (HTTP ${response.status}). ${body}`.slice(0, 500)
    }

    const content = await response.text()

    if (!content.trim()) {
      return 'The page returned no readable content.'
    }

    const maxLength = 50_000
    if (content.length > maxLength) {
      return `${content.slice(0, maxLength)}\n\n[Content truncated — ${content.length} characters total]`
    }

    return content
  },
}
