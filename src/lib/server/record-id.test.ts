import { clientRecordId } from './record-id'
import { describe, expect, it } from 'vitest'

describe('clientRecordId', () => {
  it('accepts client generated uuids', () => {
    expect(clientRecordId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e')
  })

  it('generates an id when none is requested', () => {
    expect(clientRecordId(undefined)).toMatch(/^[a-f0-9-]{36}$/)
  })

  it('rejects ids PocketBase would refuse', () => {
    expect(() => clientRecordId('short')).toThrow()
    expect(() => clientRecordId('has spaces in it 12345')).toThrow()
  })
})
