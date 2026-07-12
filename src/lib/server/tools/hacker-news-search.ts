import type { ToolDefinition } from './types'

const BASE_URL = 'https://hn.algolia.com/api/v1'
const TIMEOUT_MS = 20_000
const MAX_RETRIES = 4
const BASE_BACKOFF_MS = 500
const JITTER_MS = 250

const STORY_LIMIT = 5
const COMMENT_DEPTH = 3
const COMMENT_TEXT_LIMIT = 500
const COMMENTS_PER_NODE = 5

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

const isRetryable = (status: number) => status === 429 || status >= 500

interface HNHit {
  objectID: string
  title?: string | null
  url?: string | null
  points?: number | null
  num_comments?: number | null
  author?: string | null
  created_at?: string | null
}

interface HNItem {
  id: number
  type?: string | null
  title?: string | null
  url?: string | null
  text?: string | null
  author?: string | null
  points?: number | null
  created_at?: string | null
  children?: HNItem[] | null
}

const fetchJson = async (url: string): Promise<unknown> => {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; ++attempt) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
      if (res.ok) return await res.json()
      if (isRetryable(res.status) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BASE_BACKOFF_MS * 2 ** attempt + randInt(0, JITTER_MS)
        lastErr = new Error(`HTTP ${res.status}`)
        await sleep(delay)
        continue
      }
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      const aborted = lastErr.message === 'The operation was aborted'
      if ((aborted || lastErr.message.includes('HTTP 5') || lastErr.message.includes('HTTP 429')) && attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + randInt(0, JITTER_MS))
        continue
      }
      throw lastErr
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr ?? new Error('Request failed')
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')

const mdEscape = (s: string | null | undefined) =>
  stripHtml(s ?? '')
    .replace(/[[\]()\\`*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const storyUrl = (id: string | number) => `https://news.ycombinator.com/item?id=${id}`

const formatComment = (item: HNItem, depth: number): string => {
  if (depth > COMMENT_DEPTH) return ''
  const author = mdEscape(item.author) || 'unknown'
  const points = typeof item.points === 'number' ? item.points : 0
  const created = mdEscape(item.created_at) || 'unknown'
  const text = mdEscape(item.text)?.slice(0, COMMENT_TEXT_LIMIT) ?? ''
  const indent = '  '.repeat(depth)
  let line = `${indent}- **${author}** (${points} pts, ${created}): ${text || '(no text)'}`
  const kids = (item.children ?? []).filter(c => c.type !== 'level' && c.text)
  const shown = kids.slice(0, COMMENTS_PER_NODE)
  for (const child of shown) {
    const sub = formatComment(child, depth + 1)
    if (sub) line += `\n${sub}`
  }
  if (kids.length > shown.length) {
    line += `\n${'  '.repeat(depth + 1)}- _${kids.length - shown.length} more replies_`
  }
  return line
}

export const hackerNewsSearch: ToolDefinition = {
  name: 'hacker_news_search',
  description: 'Search Hacker News stories via the Algolia HN API. Returns matching stories with their title, URL, and the top comment threads fetched from each story. Use for technical discussions, Show HN posts, and community reactions to topics.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.',
      },
    },
    required: ['query'],
  },
  execute: async args => {
    const query = String(args.query ?? '').trim()
    if (!query) return 'Error: "query" is required.'

    const searchUrl = `${BASE_URL}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${STORY_LIMIT}`

    let data: { hits?: HNHit[] }
    try {
      data = (await fetchJson(searchUrl)) as { hits?: HNHit[] }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }

    const hits = (data.hits ?? []).filter(h => h.objectID)
    if (!hits.length) return 'No results found.'

    const blocks: string[] = []
    for (let n = 0; n < hits.length; ++n) {
      const hit = hits[n]
      const title = mdEscape(hit.title) || '(untitled)'
      const url = hit.url ?? storyUrl(hit.objectID)
      const discussion = storyUrl(hit.objectID)
      const points = hit.points ?? 0
      const numComments = hit.num_comments ?? 0

      let block = `## ${n + 1}. [${title}](${url})\n\n_${points} points · ${numComments} comments · created ${mdEscape(hit.created_at) || 'unknown'} · [discussion](${discussion})_\n`

      let item: HNItem
      try {
        item = (await fetchJson(`${BASE_URL}/items/${hit.objectID}`)) as HNItem
      } catch (e) {
        block += `\n_Comments unavailable: ${e instanceof Error ? e.message : String(e)}_`
        blocks.push(block)
        continue
      }

      const comments = (item.children ?? []).filter(c => c.type !== 'level' && c.text)
      if (!comments.length) {
        block += '\n_No comments._'
      } else {
        const rendered = comments
          .slice(0, COMMENTS_PER_NODE)
          .map(c => formatComment(c, 0))
          .join('\n')
        block += `\n### Comments\n\n${rendered}`
        if (comments.length > COMMENTS_PER_NODE) {
          block += `\n\n_${comments.length - COMMENTS_PER_NODE} more comments_`
        }
      }
      blocks.push(block)
    }

    return blocks.join('\n\n')
  },
}
