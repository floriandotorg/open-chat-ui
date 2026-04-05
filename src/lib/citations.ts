import type { ToolCallInfo } from './types'

export interface Citation {
  index: number
  url: string
  title: string
  hostname: string
}

export const extractCitations = (toolCalls?: ToolCallInfo[]): Citation[] => {
  if (!toolCalls) return []
  const citations: Citation[] = []
  for (const tc of toolCalls) {
    if (tc.name === 'web_search' && tc.result) {
      for (const match of tc.result.matchAll(/^(\d+)\.\s+\[(.+?)\]\((.+?)\)/gm)) {
        try {
          const url = match[3]
          const parsed = new URL(url)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
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

export const filterReferencedCitations = (content: string, citations: Citation[]): Citation[] => {
  if (!citations.length) return []
  const referenced = new Set<number>()
  for (const match of content.matchAll(/\[(\d+)\]/g)) {
    referenced.add(Number.parseInt(match[1], 10))
  }
  return citations.filter(c => referenced.has(c.index))
}

const escapeAttr = (str: string) => str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const processCitations = (html: string, citations: Citation[]): string => {
  if (!citations.length) return html
  const blocks = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi)
  return blocks
    .map((block, n) => {
      if (n % 2 === 1) return block
      return block.replace(/\[(\d+)\]/g, (match, num) => {
        const index = Number.parseInt(num, 10)
        const citation = citations.find(c => c.index === index)
        if (!citation) return match
        return `<a href="${escapeAttr(citation.url)}" target="_blank" rel="noopener noreferrer" class="citation-ref" title="${escapeAttr(citation.title)}"><sup>${match}</sup></a>`
      })
    })
    .join('')
}
