import { isValidFileId, sanitizeFileName } from './uploads'
import { describe, expect, it } from 'vitest'

describe('isValidFileId', () => {
  it('accepts simple ids', () => {
    for (const id of ['abc', 'A-b_9', 'x'.repeat(64)]) {
      expect(isValidFileId(id), id).toBe(true)
    }
  })

  it('rejects traversal, separators and overlong ids', () => {
    for (const id of ['', '..', 'a/b', 'a\\b', 'a.b', 'x'.repeat(65), 'a b', 'é']) {
      expect(isValidFileId(id), id).toBe(false)
    }
  })
})

describe('sanitizeFileName', () => {
  it('keeps normal names', () => {
    expect(sanitizeFileName('photo 1.jpg')).toBe('photo 1.jpg')
    expect(sanitizeFileName('Résumé.pdf')).toBe('Résumé.pdf')
  })

  it('strips directories and separators', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('C:\\Users\\x\\a.png')).toBe('a.png')
  })

  it('removes control characters and leading dots', () => {
    expect(sanitizeFileName('a\u0000b\nc.txt')).toBe('abc.txt')
    expect(sanitizeFileName('.hidden')).toBe('hidden')
  })

  it('falls back to file', () => {
    for (const name of ['', '..', '/', '.', '\u0001', null, undefined]) {
      expect(sanitizeFileName(name), String(name)).toBe('file')
    }
  })

  it('caps the length but keeps the extension', () => {
    const name = sanitizeFileName(`${'a'.repeat(300)}.jpeg`)
    expect(name.length).toBeLessThanOrEqual(200)
    expect(name.endsWith('.jpeg')).toBe(true)
  })
})
