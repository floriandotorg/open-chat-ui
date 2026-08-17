import { normalizeFences } from './markdown-fences'
import { describe, expect, it } from 'vitest'

describe('normalizeFences', () => {
  it('deepens a markdown fence wrapping nested fences', () => {
    const input = ['```markdown', '# Doc', '', '```', '--q TEXT option', '```', '', '## Next', '```'].join('\n')
    const output = normalizeFences(input)
    expect(output).toBe(['````markdown', '# Doc', '', '```', '--q TEXT option', '```', '', '## Next', '````'].join('\n'))
  })

  it('pairs with the last bare fence when inner fences balance', () => {
    const input = ['```markdown', '```js', 'x = 1', '```', 'text', '```', 'options', '```', '```unknown', 'notes', '```', 'end', '```'].join('\n')
    const output = normalizeFences(input)
    expect(output.startsWith('````markdown')).toBe(true)
    expect(output.endsWith('````')).toBe(true)
    expect(output).toContain('```js')
  })

  it('outdents inner runs longer than the outer fence', () => {
    const input = ['```markdown', '````js', 'x', '````', '```'].join('\n')
    const output = normalizeFences(input)
    expect(output).toBe(['`````markdown', '````js', 'x', '````', '`````'].join('\n'))
  })

  it('leaves a simple markdown block untouched', () => {
    const input = ['```markdown', '# Doc', '```', '', 'Done. Try:', '', '```bash', 'ls', '```'].join('\n')
    expect(normalizeFences(input)).toBe(input)
  })

  it('leaves non-markdown fences untouched', () => {
    const input = ['```js', 'x = 1', '```', '', '```py', 'y = 2', '```'].join('\n')
    expect(normalizeFences(input)).toBe(input)
  })

  it('falls back when inner fences never balance', () => {
    const input = ['```markdown', 'stray ``` fence', '# Doc', '```', 'after'].join('\n')
    expect(normalizeFences(input)).toBe(input)
  })

  it('supports md and mdx info strings', () => {
    for (const lang of ['md', 'MDX']) {
      const input = [`\`\`\`${lang}`, '```', 'inner', '```', '```'].join('\n')
      expect(normalizeFences(input).startsWith(`\`\`\`\`${lang}`)).toBe(true)
    }
  })

  it('does not treat an info-bearing fence as a closer', () => {
    const input = ['```markdown', '```js', 'x', '```', '```'].join('\n')
    const output = normalizeFences(input)
    expect(output.endsWith('````')).toBe(true)
  })
})
