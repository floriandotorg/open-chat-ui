import type { ToolDefinition } from './types'
import { fetchTranscript } from 'youtube-transcript'

const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

const extractYouTubeId = (url: string): string | null => {
  const match = url.match(YOUTUBE_RE)
  return match ? match[1] : null
}

const formatTimestamp = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const fetchYouTubeTranscript = async (videoId: string): Promise<string> => {
  const segments = await fetchTranscript(videoId)
  if (!segments.length) {
    return 'No transcript available for this video.'
  }
  const lines = segments.map(s => `[${formatTimestamp(s.offset)}] ${s.text}`)
  return `YouTube video transcript (${videoId}):\n\n${lines.join('\n')}`
}

const fetchWithJina = async (url: string, apiKey: string | null): Promise<string> => {
  const readerUrl = `https://r.jina.ai/${url}`
  const headers: Record<string, string> = { Accept: 'text/plain' }
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
}

export const fetchUrl: ToolDefinition = {
  name: 'fetch_url',
  description: 'Fetch the content of a web page and convert it to clean, readable text. Use this when you need to read the contents of a specific URL the user has shared or referenced. For YouTube videos, this automatically extracts the transcript. Returns the page content in Markdown format.',
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
    const url = args.url as string
    if (!url) {
      return 'Error: No URL provided.'
    }

    const videoId = extractYouTubeId(url)
    if (videoId) {
      return fetchYouTubeTranscript(videoId)
    }

    const apiKey = await context.getApiKey('jina')
    return fetchWithJina(url, apiKey)
  },
}
