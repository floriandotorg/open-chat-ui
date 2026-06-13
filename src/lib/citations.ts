import { findMarkdownCodeRegions } from './markdown-code-regions'
import type { ToolCallInfo } from './types'

export interface Citation {
  index: number
  url: string
  title: string
  hostname: string
}

export const extractCitations = (toolCalls?: ToolCallInfo[]): Citation[] => {
  if (!toolCalls) {
    return []
  }
  const citations: Citation[] = []
  for (const tc of toolCalls) {
    if (tc.name === 'web_search' && tc.result) {
      for (const match of tc.result.matchAll(/^(\d+)\.\s+\[(.+?)\]\((.+?)\)/gm)) {
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

export const processCitations = (html: string, citations: Citation[]): string => {
  if (!citations.length) {
    return html
  }
  const replaceCitation = buildCitationReplacer(citations)
  const blocks = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi)
  return blocks.map((block, n) => (n % 2 === 1 ? block : processTextNodes(block, replaceCitation))).join('')
}
