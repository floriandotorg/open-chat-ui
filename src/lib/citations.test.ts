import { CITATION_TOOL_NAMES, type Citation, extractCitations, filterReferencedCitations, processCitations, renumberCitations } from '$lib/citations'
import { renderMarkdown } from '$lib/markdown'
import type { ToolCallInfo } from '$lib/types'
import { describe, expect, it } from 'vitest'

const citations: Citation[] = [{ index: 1, url: 'https://example.com/source', title: 'Source', hostname: 'example.com' }]
const dollar = '$'
const rematch = `${dollar}{BASH_REMATCH[1]}`

describe('processCitations', () => {
  it('does not rewrite citation-looking text inside code copy attributes', () => {
    const html = processCitations(renderMarkdown(`\`\`\`bash\necho "${rematch}"\n\`\`\``), citations)

    expect(html).not.toContain('citation-ref')
    expect(html).toContain(rematch)
    expect(html).toContain(`data-code="echo &quot;${rematch}&quot;"`)
  })

  it('still rewrites citation references outside code blocks', () => {
    const html = processCitations(renderMarkdown(`Use this source [1].\n\n\`\`\`bash\necho "${rematch}"\n\`\`\``), citations)

    expect(html.match(/citation-ref/g)).toHaveLength(1)
    expect(html).toContain('Use this source')
    expect(html).toContain(rematch)
  })
})

describe('filterReferencedCitations', () => {
  it('ignores citation-looking text inside fenced code blocks', () => {
    expect(filterReferencedCitations(`\`\`\`bash\necho "${rematch}"\n\`\`\``, citations)).toEqual([])
  })

  it('keeps citation references outside code blocks', () => {
    expect(filterReferencedCitations(`Use this source [1].\n\n\`\`\`bash\necho "${rematch}"\n\`\`\``, citations)).toEqual(citations)
  })
})

describe('renumberCitations + extractCitations', () => {
  it('renumbers across multiple search tools into one shared sequence', () => {
    const a = renumberCitations('1. [A](https://a.com/1)\n2. [A2](https://a.com/2)', 0)
    const b = renumberCitations('1. [B](https://b.com/1)', a.count)
    const c = renumberCitations('## 1. [HN](https://hn.com/1)', a.count + b.count)
    const toolCalls: ToolCallInfo[] = [
      { id: '1', name: 'web_search', arguments: {}, result: a.result, textOffset: 0 },
      { id: '2', name: 'semantic_web_search', arguments: {}, result: b.result, textOffset: 0 },
      { id: '3', name: 'hacker_news_search', arguments: {}, result: c.result, textOffset: 0 },
    ]
    const extracted = extractCitations(toolCalls)
    expect(extracted.map(c => [c.index, c.hostname])).toEqual([
      [1, 'a.com'],
      [2, 'a.com'],
      [3, 'b.com'],
      [4, 'hn.com'],
    ])
  })

  it('extracts citations from every citation tool, not just web_search', () => {
    for (const name of CITATION_TOOL_NAMES) {
      const toolCalls: ToolCallInfo[] = [{ id: '1', name, arguments: {}, result: '1. [T](https://x.com/p)', textOffset: 0 }]
      expect(extractCitations(toolCalls)).toHaveLength(1)
    }
  })

  it('ignores numbered results from non-citation tools', () => {
    const toolCalls: ToolCallInfo[] = [{ id: '1', name: 'fetch_url', arguments: {}, result: '1. [T](https://x.com/p)', textOffset: 0 }]
    expect(extractCitations(toolCalls)).toEqual([])
  })
})
