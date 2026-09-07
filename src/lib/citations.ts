import { findMarkdownCodeRegions } from './markdown-code-regions'
import type { Citation, ToolCallSummary } from './types'

export type { Citation } from './types'

export const CITATION_TOOL_NAMES = new Set(['web_search', 'semantic_web_search', 'news_search', 'wikipedia_search', 'academic_search', 'hacker_news_search'])

export const renumberCitations = (result: string, offset: number): { result: string; count: number } => {
  let count = 0
  const renumbered = result.replace(/^(##\s+)?(\d+)\.\s+/gm, (_m, prefix: string | undefined) => {
    ++count
    return `${prefix ?? ''}${offset + count}. `
  })
  return { result: renumbered, count }
}

export const extractCitations = (entries?: Iterable<{ name: string; result?: string }>): Citation[] => {
  if (!entries) {
    return []
  }
  const citations: Citation[] = []
  for (const tc of entries) {
    if (CITATION_TOOL_NAMES.has(tc.name) && tc.result) {
      for (const match of tc.result.matchAll(/^(?:##\s+)?(\d+)\.\s+\[(.+?)\]\((.+?)\)/gm)) {
        try {
          const url = match[3]
          const parsed = new URL(url)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            continue
          }
          citations.push({
            index: Number.parseInt(match[1], 10),
            url,
            title: match[2],
            hostname: parsed.hostname,
          })
        } catch {}
      }
    }
  }
  return citations
}

// Citations are precomputed server-side onto each tool call summary; legacy
// rows without them fall back to parsing the inline result.
export const collectCitations = (toolCalls?: ToolCallSummary[]): Citation[] => {
  if (!toolCalls) {
    return []
  }
  const citations: Citation[] = []
  const legacy: { name: string; result?: string }[] = []
  for (const tc of toolCalls) {
    if (tc.citations) {
      citations.push(...tc.citations)
    } else if (tc.result) {
      legacy.push(tc)
    }
  }
  return [...citations, ...extractCitations(legacy)]
}

const removeMarkdownCode = (text: string): string => {
  const regions = findMarkdownCodeRegions(text)
  if (regions.length === 0) {
    return text
  }
  let out = ''
  let cursor = 0
  for (const [start, end] of regions) {
    out += text.slice(cursor, start)
    cursor = end
  }
  return out + text.slice(cursor)
}

export const filterReferencedCitations = (content: string, citations: Citation[]): Citation[] => {
  if (!citations.length) {
    return []
  }
  const referenced = new Set<number>()
  for (const match of removeMarkdownCode(content).matchAll(/\[(\d+)\]/g)) {
    referenced.add(Number.parseInt(match[1], 10))
  }
  return citations.filter(c => referenced.has(c.index))
}

const escapeAttr = (str: string) => str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const buildCitationReplacer = (citations: Citation[]) => {
  const citationsByIndex = new Map(citations.map(citation => [citation.index, citation]))
  return (match: string, num: string): string => {
    const index = Number.parseInt(num, 10)
    const citation = citationsByIndex.get(index)
    if (!citation) {
      return match
    }
    return `<a href="${escapeAttr(citation.url)}" target="_blank" rel="noopener noreferrer" class="citation-ref" title="${escapeAttr(citation.title)}"><sup>${match}</sup></a>`
  }
}

const processTextNodes = (html: string, replaceCitation: (match: string, num: string) => string): string => {
  let out = ''
  let cursor = 0
  for (const tag of html.matchAll(/<[^>]*>/g)) {
    const start = tag.index
    if (start === undefined) {
      continue
    }
    out += html.slice(cursor, start).replace(/\[(\d+)\]/g, replaceCitation)
    out += tag[0]
    cursor = start + tag[0].length
  }
  return out + html.slice(cursor).replace(/\[(\d+)\]/g, replaceCitation)
}

const PROCESS_CACHE_MAX = 500
const processCache = new Map<string, string>()

export const processCitations = (html: string, citations: Citation[]): string => {
  if (!citations.length) {
    return html
  }
  const key = `${html} ${citations.map(c => `${c.index}:${c.url}`).join('|')}`
  const hit = processCache.get(key)
  if (hit !== undefined) {
    return hit
  }
  const replaceCitation = buildCitationReplacer(citations)
  const blocks = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi)
  const processed = blocks.map((block, n) => (n % 2 === 1 ? block : processTextNodes(block, replaceCitation))).join('')
  if (processCache.size >= PROCESS_CACHE_MAX) {
    const oldest = processCache.keys().next().value
    if (oldest !== undefined) {
      processCache.delete(oldest)
    }
  }
  processCache.set(key, processed)
  return processed
}
