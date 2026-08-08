import { rmSync, writeFileSync } from 'node:fs'
import { getUploadPath, hasUpload } from './uploads'
import { afterAll, describe, expect, it } from 'vitest'

describe('hasUpload', () => {
  it('returns true for an existing upload and false for a missing one', () => {
    writeFileSync(getUploadPath('present-test.jpg'), 'x')
    expect(hasUpload('present-test.jpg')).toBe(true)
    expect(hasUpload('missing-test.jpg')).toBe(false)
  })
})

afterAll(() => {
  rmSync(getUploadPath('present-test.jpg'), { force: true })
})
