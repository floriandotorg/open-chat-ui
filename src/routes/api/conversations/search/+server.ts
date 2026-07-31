import { requireUser } from '$lib/server/auth-guard'
import { pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

interface SearchHit {
  id: string
  title: string
  titleHasMatch: boolean
  snippet: string | null
  snippetRole: 'user' | 'assistant' | null
  messageMatchCount: number
  favorite: boolean | null
  updatedAt: Date
  score: number
}

const MAX_TERMS = 8
const SNIPPET_PREFIX = 30
const SNIPPET_SUFFIX = 160
const MAX_RESULTS = 50

const tokenize = (query: string) =>
  Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0),
    ),
  ).slice(0, MAX_TERMS)

const countOccurrences = (haystackLower: string, needle: string) => {
  if (!needle) return 0
  let count = 0
  let idx = haystackLower.indexOf(needle)
  while (idx !== -1) {
    ++count
    idx = haystackLower.indexOf(needle, idx + needle.length)
  }
  return count
}

const buildSnippet = (content: string, terms: string[]): string => {
  const collapsed = content.replace(/\s+/g, ' ').trim()
  const lower = collapsed.toLowerCase()
  let firstIdx = -1
  for (const term of terms) {
    const idx = lower.indexOf(term)
    if (idx >= 0 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx
  }
  if (firstIdx === -1) return collapsed.slice(0, SNIPPET_PREFIX + SNIPPET_SUFFIX)
  const start = Math.max(0, firstIdx - SNIPPET_PREFIX)
  const end = Math.min(collapsed.length, firstIdx + SNIPPET_SUFFIX)
  let snippet = collapsed.slice(start, end)
  if (start > 0) snippet = `…${snippet.replace(/^\S*\s/, '')}`
  if (end < collapsed.length) snippet = `${snippet.replace(/\s\S*$/, '')}…`
  return snippet
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const userId = requireUser(locals.user).id
  const rawQuery = (url.searchParams.get('q') ?? '').trim()
  if (rawQuery.length < 2) return json({ terms: [], results: [] })

  const terms = tokenize(rawQuery)
  if (terms.length === 0) return json({ terms, results: [] })

  const phrase = terms.join(' ')

  const allConvs = await pb.collection('conversations').getFullList({ filter: pb.filter('user = {:u}', { u: userId }), fields: 'id,title,favorite,updatedAt' })

  if (allConvs.length === 0) return json({ terms, results: [] })

  const userFilter = pb.filter('conversation.user = {:u}', { u: userId })
  const termFilter = terms.map(t => pb.filter('content ~ {:t}', { t: `%${t}%` })).join(' || ')
  const filter = `${userFilter} && (${termFilter}) && (role = 'user' || role = 'assistant')`

  const matchingMessages = await pb.collection('messages').getFullList({ filter, fields: 'conversation,role,content,createdAt' })

  const messagesByConv = new Map<string, { conversationId: string; role: string; content: string; createdAt: Date }[]>()
  for (const msg of matchingMessages) {
    const list = messagesByConv.get(msg.conversation) ?? []
    list.push({ conversationId: msg.conversation, role: msg.role, content: msg.content, createdAt: new Date(msg.createdAt) })
    messagesByConv.set(msg.conversation, list)
  }

  const nowMs = Date.now()
  const hits: SearchHit[] = []

  for (const conv of allConvs) {
    const titleLower = conv.title.toLowerCase()
    const titleTerms = new Set(terms.filter(t => titleLower.includes(t)))
    const convMessages = messagesByConv.get(conv.id) ?? []
    const contentTerms = new Set<string>()
    let totalOccurrences = 0

    let bestMessage: { content: string; role: 'user' | 'assistant'; hits: number; createdAt: Date } | null = null

    for (const msg of convMessages) {
      const lower = msg.content.toLowerCase()
      let messageHits = 0
      for (const term of terms) {
        const occ = countOccurrences(lower, term)
        if (occ > 0) {
          contentTerms.add(term)
          messageHits += occ
        }
      }
      totalOccurrences += messageHits
      if (messageHits > 0) {
        const role = msg.role === 'user' ? 'user' : 'assistant'
        if (!bestMessage || messageHits > bestMessage.hits || (messageHits === bestMessage.hits && msg.createdAt > bestMessage.createdAt)) {
          bestMessage = { content: msg.content, role, hits: messageHits, createdAt: msg.createdAt }
        }
      }
    }

    const coveredTerms = new Set([...titleTerms, ...contentTerms])
    if (coveredTerms.size < terms.length) continue

    const titlePhraseHit = terms.length > 1 && titleLower.includes(phrase) ? 1 : 0
    const updatedAt = new Date(conv.updatedAt)
    const daysSinceUpdate = Math.max(0, (nowMs - updatedAt.getTime()) / 86400000)
    const recencyBoost = Math.max(0, 15 - daysSinceUpdate * 0.2)

    const score = titlePhraseHit * 500 + titleTerms.size * 100 + contentTerms.size * 30 + Math.min(totalOccurrences, 20) * 2 + recencyBoost

    hits.push({
      id: conv.id,
      title: conv.title,
      favorite: conv.favorite ?? null,
      titleHasMatch: titleTerms.size > 0,
      snippet: bestMessage ? buildSnippet(bestMessage.content, terms) : null,
      snippetRole: bestMessage?.role ?? null,
      messageMatchCount: convMessages.length,
      updatedAt,
      score,
    })
  }

  hits.sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime())

  return json({ terms, results: hits.slice(0, MAX_RESULTS) })
}
