import type { ToolDefinition } from './types'

const BASE_URL = 'https://www.reddit.com'
const USER_AGENT = 'script:open-chat-ui-reddit:v1.0.0'
const TIMEOUT_MS = 20_000
const MIN_DELAY_MS = 500
const MAX_DELAY_MS = 1500
const DEFAULT_MAX_CHARS = 1000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const randInt = (min: number, max: number) => Math.min(min, max) + Math.floor(Math.random() * (Math.abs(max - min) + 1))
const toIso = (sec: number) => new Date(sec * 1000).toISOString()
const hoursAgo = (utc: number) => (Date.now() - utc * 1000) / 3_600_000

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.max(lo, Math.min(hi, x))
}

const parseCommaList = (s: unknown): string[] => {
  if (!s || typeof s !== 'string') return []
  return s.split(',').map(x => x.trim()).filter(Boolean)
}

const permalink = (p: string | undefined | null) => {
  if (!p) return null
  if (p.startsWith('http')) return p
  return `${BASE_URL}${p.startsWith('/') ? '' : '/'}${p}`
}

const extractPostId = (input: unknown): string | null => {
  const s = String(input ?? '').trim()
  if (!s) return null
  if (/^[a-z0-9]{5,10}$/i.test(s)) return s
  const m = s.match(/comments\/([a-z0-9]{5,10})/i)
  return m ? m[1] : null
}

const fetchRedditJson = async (url: string): Promise<unknown> => {
  await sleep(randInt(MIN_DELAY_MS, MAX_DELAY_MS))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    if (text.trim().startsWith('<')) throw new Error('Reddit returned HTML instead of JSON')
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

const fetchWithRetry = async (url: string, retries = 3): Promise<unknown> => {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= retries; ++attempt) {
    try {
      return await fetchRedditJson(url)
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      const msg = lastErr.message
      const retryable = msg.includes('HTTP 429') || msg.includes('HTTP 5') || msg.includes('aborted') || msg.includes('HTML instead of JSON')
      if (!retryable || attempt === retries) break
      await sleep(600 * 2 ** attempt + randInt(0, 400))
    }
  }
  throw lastErr ?? new Error('Request failed')
}

const buildUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path
  const [p, qs] = path.split('?')
  const jsonPath = p.endsWith('.json') ? p : `${p}.json`
  return qs ? `${BASE_URL}${jsonPath}?${qs}` : `${BASE_URL}${jsonPath}`
}

interface RedditThing {
  kind?: string
  data?: Record<string, unknown>
}
interface Listing {
  data?: { children?: RedditThing[]; after?: string; before?: string }
}

const normalisePost = (node: RedditThing) => {
  const d = node.data ?? (node as Record<string, unknown>)
  const utc = (d.created_utc as number) ?? 0
  const selftext = d.selftext as string | undefined
  return {
    id: d.id,
    subreddit: d.subreddit,
    title: d.title,
    author: d.author,
    score: d.score,
    num_comments: d.num_comments,
    created_utc: utc,
    created_iso: utc ? toIso(utc) : null,
    permalink: permalink(d.permalink as string | undefined),
    url: d.url,
    is_self: d.is_self,
    flair: (d.link_flair_text as string) ?? null,
    selftext_snippet: selftext ? selftext.slice(0, 800) : null,
  }
}

interface CommentOpts { depth: number; parentFullname: string | null; maxChars: number }
const normaliseComment = (node: RedditThing, { depth, parentFullname, maxChars }: CommentOpts) => {
  const d = node.data ?? (node as Record<string, unknown>)
  const utc = (d.created_utc as number) ?? 0
  const body = (d.body as string) ?? ''
  return {
    id: d.id,
    author: d.author,
    score: d.score,
    created_utc: utc,
    created_iso: utc ? toIso(utc) : null,
    depth,
    parent_fullname: parentFullname ?? d.parent_id ?? null,
    permalink: permalink(d.permalink as string | undefined),
    body_snippet: body ? body.slice(0, maxChars) : null,
  }
}

interface TreeOpts { depth?: number; parentFullname?: string | null; maxDepth?: number; maxChars?: number }
const parseCommentsTree = (children: RedditThing[], opts: TreeOpts): { comments: ReturnType<typeof normaliseComment>[]; moreCount: number } => {
  const { depth = 0, parentFullname = null, maxDepth = 8, maxChars = DEFAULT_MAX_CHARS } = opts
  const out: ReturnType<typeof normaliseComment>[] = []
  let moreCount = 0
  for (const node of children) {
    if (!node) continue
    if (node.kind === 'more') {
      moreCount += (typeof node.data?.count === 'number' ? node.data.count : 0) as number
      continue
    }
    if (node.kind !== 't1') continue
    const author = node.data?.author as string | undefined
    const body = node.data?.body as string | undefined
    const deleted = author === '[deleted]' || body === '[deleted]' || body === '[removed]' || body == null
    if (!deleted) {
      out.push(normaliseComment(node, { depth, parentFullname, maxChars }))
    }
    if (depth < maxDepth) {
      const replies = node.data?.replies as Listing | undefined
      const replyChildren = replies?.data?.children
      if (Array.isArray(replyChildren)) {
        const pf = (node.data?.name as string) ?? parentFullname
        const parsed = parseCommentsTree(replyChildren, { depth: depth + 1, parentFullname: pf, maxDepth, maxChars })
        out.push(...parsed.comments)
        moreCount += parsed.moreCount
      }
    }
  }
  return { comments: out, moreCount }
}

const keywordHits = (text: string, keywords: string[]) => {
  const t = text.toLowerCase()
  return keywords.filter(kw => kw && t.includes(kw.toLowerCase()))
}

type Args = Record<string, unknown>

const cmdPosts = async (args: Args) => {
  const subreddit = String(args.subreddit ?? '')
  if (!subreddit) throw new Error('posts requires "subreddit"')
  const sort = String(args.sort ?? 'hot')
  const time = String(args.time ?? 'day')
  const limit = clamp(args.limit, 1, 100, 10)

  const qs = new URLSearchParams({ limit: String(limit) })
  if (sort === 'top' || sort === 'controversial') qs.set('t', time)

  const listing = await fetchWithRetry(buildUrl(`/r/${subreddit}/${sort}?${qs}`)) as Listing
  const posts = (listing?.data?.children ?? []).filter(x => x.kind === 't3').map(normalisePost)
  return JSON.stringify({ subreddit, sort, limit, after: listing?.data?.after ?? null, posts })
}

const cmdSearch = async (args: Args) => {
  const scope = String(args.subreddit ?? args.scope ?? 'all')
  const query = String(args.query ?? '')
  if (!query) throw new Error('search requires "query"')
  const sort = String(args.sort ?? 'relevance')
  const time = String(args.time ?? 'all')
  const limit = clamp(args.limit, 1, 100, 10)

  const qs = new URLSearchParams({ q: query, sort, t: time, limit: String(limit) })
  if (scope !== 'all') qs.set('restrict_sr', 'on')
  const path = scope === 'all' ? `/search?${qs}` : `/r/${scope}/search?${qs}`

  const listing = await fetchWithRetry(buildUrl(path)) as Listing
  const posts = (listing?.data?.children ?? []).filter(x => x.kind === 't3').map(normalisePost)
  return JSON.stringify({ scope, query, sort, time, limit, after: listing?.data?.after ?? null, posts })
}

const cmdThread = async (args: Args) => {
  const postId = extractPostId(args.post_id)
  if (!postId) throw new Error('thread requires "post_id" (id or URL)')
  const limit = clamp(args.limit, 1, 500, 50)
  const maxDepth = clamp(args.depth, 0, 20, 8)
  const maxChars = clamp(args.max_chars, 50, 20000, DEFAULT_MAX_CHARS)

  const data = await fetchWithRetry(buildUrl(`/comments/${postId}?limit=${limit}`)) as [Listing, Listing]
  const postChild = data[0]?.data?.children?.find(x => x.kind === 't3')
  const post = postChild ? normalisePost(postChild) : null
  const parsed = parseCommentsTree(data[1]?.data?.children ?? [], { maxDepth, maxChars })
  return JSON.stringify({ post, comments: parsed.comments, more_count_estimate: parsed.moreCount })
}

const cmdFind = async (args: Args) => {
  const subreddits = parseCommaList(args.subreddits)
  if (subreddits.length === 0) throw new Error('find requires "subreddits" (comma-separated)')
  const query = args.query ? String(args.query) : ''
  const include = parseCommaList(args.include)
  const exclude = parseCommaList(args.exclude)
  const minScore = typeof args.min_score === 'number' ? args.min_score : 0
  const maxAgeHours = typeof args.max_age_hours === 'number' ? args.max_age_hours : null
  const perSubLimit = clamp(args.per_subreddit_limit, 1, 100, 25)
  const maxResults = clamp(args.max_results, 1, 100, 10)
  const rank = String(args.rank ?? 'new')

  const collected: (ReturnType<typeof normalisePost> & { reason: string[]; match_score: number })[] = []

  for (const sub of subreddits) {
    let posts: ReturnType<typeof normalisePost>[]
    if (query) {
      const qs = new URLSearchParams({ q: query, restrict_sr: 'on', sort: 'new', t: 'all', limit: String(perSubLimit) })
      const listing = await fetchWithRetry(buildUrl(`/r/${sub}/search?${qs}`)) as Listing
      posts = (listing?.data?.children ?? []).filter(x => x.kind === 't3').map(normalisePost)
    } else {
      const listing = await fetchWithRetry(buildUrl(`/r/${sub}/new?limit=${perSubLimit}`)) as Listing
      posts = (listing?.data?.children ?? []).filter(x => x.kind === 't3').map(normalisePost)
    }

    for (const p of posts) {
      const text = `${p.title ?? ''}\n\n${p.selftext_snippet ?? ''}`
      const hits = keywordHits(text, include)
      const exHits = keywordHits(text, exclude)

      if (include.length > 0 && hits.length === 0) continue
      if (exclude.length > 0 && exHits.length > 0) continue
      if (typeof p.score === 'number' && p.score < minScore) continue
      if (maxAgeHours != null && hoursAgo(p.created_utc) > maxAgeHours) continue

      const reason: string[] = []
      if (query) reason.push(`query:${query}`)
      if (hits.length) reason.push(`include:${hits.join(',')}`)
      if (maxAgeHours != null) reason.push(`age_h:${hoursAgo(p.created_utc).toFixed(1)}`)
      if (minScore) reason.push(`minScore:${minScore}`)

      collected.push({ ...p, reason, match_score: hits.length })
    }
  }

  collected.sort((a, b) => {
    if (rank === 'score') return ((b.score as number) ?? 0) - ((a.score as number) ?? 0)
    if (rank === 'comments') return ((b.num_comments as number) ?? 0) - ((a.num_comments as number) ?? 0)
    if (rank === 'match') return b.match_score - a.match_score
    return b.created_utc - a.created_utc
  })

  return JSON.stringify({ criteria: { subreddits, query: query || null, include, exclude, minScore, maxAgeHours, maxResults, rank }, results: collected.slice(0, maxResults) })
}

const COMMANDS: Record<string, (args: Args) => Promise<string>> = {
  posts: cmdPosts,
  search: cmdSearch,
  thread: cmdThread,
  find: cmdFind,
}

export const redditQuery: ToolDefinition = {
  name: 'reddit_query',
  description: `Query Reddit for posts, comments, and discussions using public endpoints (no API key needed).

Workflow guidance:
- Clarify scope if needed: subreddits + topic keywords + timeframe.
- Start with find (or posts/search) using small limits.
- For 1–3 promising items, fetch context via thread.
- Present the user a shortlist: title, subreddit, score, created time, permalink, and a brief reason why it matched.

Commands:
- "find": Multi-subreddit filtered search. Params: subreddits (required, comma-separated), query, include, exclude (comma-separated keywords), min_score, max_age_hours, max_results, per_subreddit_limit, rank (new|score|comments|match).
- "posts": List posts from a subreddit. Params: subreddit (required), sort (hot|new|top|controversial|rising), time (day|week|month|year|all), limit.
- "search": Search posts. Params: query (required), subreddit (default "all"), sort (relevance|top|new|comments), time, limit.
- "thread": Fetch a post with its comment tree. Params: post_id (required, id or URL), limit, depth, max_chars.`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to run: "find", "posts", "search", or "thread".',
      },
      subreddit: {
        type: 'string',
        description: 'Subreddit name (for posts/search).',
      },
      subreddits: {
        type: 'string',
        description: 'Comma-separated subreddit names (for find).',
      },
      query: {
        type: 'string',
        description: 'Search query text.',
      },
      post_id: {
        type: 'string',
        description: 'Post ID or full Reddit URL (for thread).',
      },
      sort: {
        type: 'string',
        description: 'Sort method.',
      },
      time: {
        type: 'string',
        description: 'Time filter (day, week, month, year, all).',
      },
      limit: {
        type: 'integer',
        description: 'Number of results to return.',
      },
      depth: {
        type: 'integer',
        description: 'Max comment tree depth (for thread).',
      },
      max_chars: {
        type: 'integer',
        description: 'Max characters per comment body snippet.',
      },
      include: {
        type: 'string',
        description: 'Comma-separated keywords that must appear (for find).',
      },
      exclude: {
        type: 'string',
        description: 'Comma-separated keywords to exclude (for find).',
      },
      min_score: {
        type: 'integer',
        description: 'Minimum post score (for find).',
      },
      max_age_hours: {
        type: 'number',
        description: 'Maximum post age in hours (for find).',
      },
      max_results: {
        type: 'integer',
        description: 'Maximum results to return (for find).',
      },
      per_subreddit_limit: {
        type: 'integer',
        description: 'Posts to fetch per subreddit (for find).',
      },
      rank: {
        type: 'string',
        description: 'Ranking method for find: new, score, comments, or match.',
      },
    },
    required: ['command'],
  },
  execute: async (args) => {
    const command = String(args.command ?? '')
    const handler = COMMANDS[command]
    if (!handler) {
      return `Error: Unknown command "${command}". Use one of: ${Object.keys(COMMANDS).join(', ')}`
    }
    try {
      return await handler(args)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
}
