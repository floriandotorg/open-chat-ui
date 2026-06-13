import { type Citation, filterReferencedCitations, processCitations } from '$lib/citations'
import { renderMarkdown } from '$lib/markdown'
import { describe, expect, it } from 'vitest'

const citations: Citation[] = [{ index: 1, url: 'https://example.com/source', title: 'Source', hostname: 'example.com' }]
const dollar = '$'
const rematch = `${dollar}{BASH_REMATCH[1]}`

describe('processCitations', () => {
  it('does not rewrite citation-looking text inside code copy attributes', () => {
    const html = processCitations(renderMarkdown(`\`\`\`bash\necho "${rematch}"\n\`\`\``), citations)

    expect(html).not.toContain('citation-ref')
    expect(html).toContain(rematch)
    expect(html).toContain(`data-code="echo &quot;${rematch}&quot;`)
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
