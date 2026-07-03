import type { ToolDefinition } from './types'

interface BraveResult {
  title?: string
  url?: string
  description?: string
  age?: string
  page_age?: string
  long_desc?: string
  question?: string
  answer?: string | { text?: string }
  data?: { forum_name?: string }
  profile?: { name?: string }
}

interface BraveSection {
  type?: string
  results?: BraveResult[]
}

interface BraveResponse {
  web?: BraveSection
  discussions?: BraveSection
  infobox?: BraveSection
  videos?: BraveSection
  faq?: BraveSection
}

const stripHtml = (s: string): string =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const formatResult = (r: BraveResult, n: number): string => {
  const title = r.title ? stripHtml(r.title) : ''
  const url = r.url ?? ''
  const desc = r.description ? stripHtml(r.description) : ''
  const age = r.age ? ` _(${r.age})_` : ''
  const snippet = desc ? `\n  ${desc}` : ''
  return `${n}. [${title}](${url})${age}${snippet}`
}

const formatDiscussion = (r: BraveResult, n: number): string => {
  const title = r.title ? stripHtml(r.title) : ''
  const url = r.url ?? ''
  const forum = r.data?.forum_name ?? ''
  const desc = r.description ? stripHtml(r.description) : ''
  const age = r.age ? ` _(${r.age})_` : ''
  const forumTag = forum ? ` \`${forum}\`` : ''
  const snippet = desc ? `\n  ${desc}` : ''
  return `${n}. [${title}](${url})${forumTag}${age}${snippet}`
}

const formatVideo = (r: BraveResult, n: number): string => {
  const title = r.title ? stripHtml(r.title) : ''
  const url = r.url ?? ''
  const desc = r.description ? stripHtml(r.description) : ''
  const snippet = desc ? `\n  ${desc}` : ''
  return `${n}. [${title}](${url})${snippet}`
}

const formatFaq = (r: BraveResult, n: number): string => {
  const title = r.title ? stripHtml(r.title) : ''
  const url = r.url ?? ''
  const question = r.question ? stripHtml(r.question) : title
  const answerText = typeof r.answer === 'string' ? r.answer : (r.answer?.text ?? '')
  const answer = answerText ? stripHtml(answerText) : ''
  const a = answer ? `\n  A: ${answer}` : ''
  return `${n}. **Q: ${question}**\n  [${url}](${url})${a}`
}

const FRESHNESS_VALUES = ['pd', 'pw', 'pm', 'py'] as const
type Freshness = (typeof FRESHNESS_VALUES)[number]

const isFreshness = (v: string): v is Freshness => (FRESHNESS_VALUES as readonly string[]).includes(v)

export const braveSearch: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information on any topic using the Brave search engine. Use this when you need up-to-date information, facts, news, or anything that might have changed after your training cutoff.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      limit: {
        type: 'integer',
        description: 'Number of web results to return (1-20, default 5)',
      },
      country: {
        type: 'string',
        description: 'Two-letter country code for regional results (e.g. "us", "de", "fr", "gb"). Defaults to none.',
      },
      freshness: {
        type: 'string',
        description: 'Restrict to pages indexed within a time window: "pd" (24h), "pw" (7d), "pm" (31d), "py" (365d). Omit for no time filter.',
        enum: [...FRESHNESS_VALUES],
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
    const limit = Math.min(20, Math.max(1, (args.limit as number) ?? 5))
    const country = (args.country as string | undefined)?.trim().toLowerCase() || undefined
    const freshnessRaw = (args.freshness as string | undefined)?.trim().toLowerCase()
    const freshness = freshnessRaw && isFreshness(freshnessRaw) ? freshnessRaw : undefined

    const params = new URLSearchParams({
      q: query,
      count: String(limit),
      safesearch: 'off',
    })
    if (country) params.set('country', country)
    if (freshness) params.set('freshness', freshness)

    const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return `Error: Brave search failed (HTTP ${response.status}). ${body}`
    }

    const data = (await response.json()) as BraveResponse
    const sections: string[] = []

    const infobox = data.infobox?.results?.[0]
    if (infobox?.long_desc) {
      sections.push(`## Summary\n${stripHtml(infobox.long_desc)}`)
    }

    const webResults = data.web?.results?.slice(0, limit) ?? []
    if (webResults.length > 0) {
      sections.push(`## Web Results\n${webResults.map((r, n) => formatResult(r, n + 1)).join('\n')}`)
    }

    const discussions = data.discussions?.results ?? []
    if (discussions.length > 0) {
      sections.push(`## Discussions\n${discussions.map((r, n) => formatDiscussion(r, n + 1)).join('\n')}`)
    }

    const videos = data.videos?.results ?? []
    if (videos.length > 0) {
      sections.push(`## Videos\n${videos.map((r, n) => formatVideo(r, n + 1)).join('\n')}`)
    }

    const faqs = data.faq?.results ?? []
    if (faqs.length > 0) {
      sections.push(`## FAQ\n${faqs.map((r, n) => formatFaq(r, n + 1)).join('\n')}`)
    }

    return sections.length > 0 ? sections.join('\n\n') : 'No results found.'
  },
}
