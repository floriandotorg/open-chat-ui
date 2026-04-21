import { stripMarkdown } from '$lib/strip-markdown'
import { describe, expect, it } from 'vitest'

describe('stripMarkdown', () => {
  it('processes links before citation references', () => {
    expect(stripMarkdown('[123](http://example.com)')).toBe('123')
  })

  it('strips numeric link preserving text', () => {
    expect(stripMarkdown('[42](https://example.com)')).toBe('42')
  })

  it('strips citation reference alone', () => {
    expect(stripMarkdown('See [1] for details')).toBe('See  for details')
  })

  it('strips multiple citation references', () => {
    expect(stripMarkdown('Text [1] and [2] here')).toBe('Text  and  here')
  })

  it('strips regular link preserving text', () => {
    expect(stripMarkdown('[click here](https://example.com)')).toBe('click here')
  })

  it('handles link with numeric text adjacent to citation', () => {
    expect(stripMarkdown('[5](http://a.com) and [6] ref')).toBe('5 and  ref')
  })
})
