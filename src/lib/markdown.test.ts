import { renderMarkdown } from '$lib/markdown'
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

  it('renders multiple inline maths', () => {
    const html = renderMarkdown('Let $a$ and $b$ be numbers.')
    expect(html).toContain('katex')
  })

  it('renders display math with multi-line content', () => {
    const html = renderMarkdown('$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$')
    expect(html).toContain('katex')
  })
})
