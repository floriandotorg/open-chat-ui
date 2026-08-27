import { renderMarkdown, renderMarkdownBlocks } from '$lib/markdown'
import { stripMarkdown } from '$lib/strip-markdown'
import { describe, expect, it } from 'vitest'

describe('stripMarkdown', () => {
  it('strips bold', () => {
    expect(stripMarkdown('**bold**')).toBe('bold')
  })

  it('strips italic', () => {
    expect(stripMarkdown('*italic*')).toBe('italic')
  })

  it('strips bold+italic combined', () => {
    expect(stripMarkdown('***text***')).toBe('text')
  })

  it('strips bold containing italic', () => {
    expect(stripMarkdown('**bold *italic* bold**')).toBe('bold italic bold')
  })

  it('strips nested asterisks inside bold', () => {
    expect(stripMarkdown('**a*b*c**')).toBe('abc')
  })

  it('strips inline code', () => {
    expect(stripMarkdown('use `foo` bar')).toBe('use foo bar')
  })

  it('strips code blocks', () => {
    expect(stripMarkdown('before\n```js\nx=1\n```\nafter')).toBe('before\n\nafter')
  })

  it('strips links', () => {
    expect(stripMarkdown('[click](https://example.com)')).toBe('click')
  })

  it('strips images', () => {
    expect(stripMarkdown('![alt](img.png)')).toBe('')
  })

  it('strips headings', () => {
    expect(stripMarkdown('## Title')).toBe('Title')
  })

  it('strips strikethrough', () => {
    expect(stripMarkdown('~~deleted~~')).toBe('deleted')
  })

  it('strips blockquotes', () => {
    expect(stripMarkdown('> quote')).toBe('quote')
  })

  it('strips display math delimiters', () => {
    expect(stripMarkdown('$$e^{i\\pi} + 1 = 0$$')).toBe('e^{i\\pi} + 1 = 0')
  })

  it('strips inline math delimiters', () => {
    expect(stripMarkdown('value $x^2$ here')).toBe('value x^2 here')
  })

  it('does not strip currency $', () => {
    expect(stripMarkdown('It costs $5 and $10.')).toBe('It costs $5 and $10.')
  })
})

describe('renderMarkdown', () => {
  it('renders inline math', () => {
    const html = renderMarkdown('The value $x^2$ is squared.')
    expect(html).toContain('katex')
    expect(html).toContain('x^2')
  })

  it('renders display math', () => {
    const html = renderMarkdown('$$e^{i\\pi} + 1 = 0$$')
    expect(html).toContain('katex')
    expect(html).toContain('e^{i\\pi}')
  })

  it('does not confuse currency $ with math', () => {
    const html = renderMarkdown('It costs $5 and $10.')
    expect(html).not.toContain('katex')
  })

  it('renders bold', () => {
    const html = renderMarkdown('**bold**')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('renders code blocks with highlighting', () => {
    const html = renderMarkdown('```js\nconsole.log("hi")\n```')
    expect(html).toContain('code-block')
    expect(html).toContain('hljs')
  })

  it('renders inline code', () => {
    const html = renderMarkdown('use `foo` here')
    expect(html).toContain('<code>foo</code>')
  })

  it('keeps nested fences inside a markdown code block', () => {
    const src = ['```markdown', '# Spec', '', '### `wiki search` primary tool.', '', '```', '--q TEXT additional query variant', '--mode hybrid|lex|vec default hybrid', '```', '', '### `wiki read`', '```'].join('\n')
    const html = renderMarkdown(src)
    expect(html.match(/code-block/g)).toHaveLength(1)
    expect(html).not.toContain('<h3')
    expect(html).toContain('--q TEXT')
  })

  it('renders multiple inline maths', () => {
    const html = renderMarkdown('Let $a$ and $b$ be numbers.')
    expect(html).toContain('katex')
  })

  it('renders display math with multi-line content', () => {
    const html = renderMarkdown('$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$')
    expect(html).toContain('katex')
  })

  it('does not render math inside fenced code blocks', () => {
    const dollar = '$'
    const src = ['```bash', `SRC="${dollar}(readlink -f "${dollar}{DIR}/last")"`, `cp "${dollar}SRC" "${dollar}{DIR}/snapshot_${dollar}{NAME}.txt"`, '```'].join('\n')
    const html = renderMarkdown(src)
    expect(html).not.toContain('katex')
    expect(html).toContain('readlink')
    expect(html).toContain('snapshot_')
  })

  it('does not render math inside inline code', () => {
    const html = renderMarkdown('use `$x$ and $y$` literally')
    expect(html).not.toContain('katex')
  })

  it('still renders math outside code blocks when code is present', () => {
    const html = renderMarkdown('Before $a^2$\n```bash\necho $FOO\n```\nafter $b^2$')
    expect(html).toContain('katex')
    expect(html).toContain('echo $FOO')
  })

  it('does not auto-detect languages on unlabeled code blocks', () => {
    const html = renderMarkdown('```\nconst x = 1\nif (x) { console.log(x) }\n```')
    expect(html).toContain('code-block')
    expect(html).not.toContain('<span class="hljs-')
  })
})

describe('renderMarkdownBlocks', () => {
  it('joined blocks match the full render', () => {
    const src = '# Title\n\npara with $x^2$ math\n\n```js\nconsole.log(1)\n```\n\n- a\n- b'
    expect(renderMarkdownBlocks(src).join('')).toBe(renderMarkdown(src))
  })

  it('keeps earlier blocks stable while text is appended', () => {
    const before = renderMarkdownBlocks('first paragraph\n\nsecond par')
    const after = renderMarkdownBlocks('first paragraph\n\nsecond paragraph continues')
    expect(after[0]).toBe(before[0])
    expect(after[after.length - 1]).toContain('continues')
  })

  it('does not split inside fenced code blocks', () => {
    const blocks = renderMarkdownBlocks('```js\nconst a = 1\n\nconst b = 2\n```')
    expect(blocks.filter(b => b.includes('code-block'))).toHaveLength(1)
    expect(blocks.join('')).toContain('const b = 2')
  })

  it('does not leak cached math across different formulas', () => {
    const first = renderMarkdownBlocks('value $a+b$ here')
    const second = renderMarkdownBlocks('value $c+d$ here')
    expect(first.join('')).not.toBe(second.join(''))
    expect(second.join('')).toContain('c')
  })
})
