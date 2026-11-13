import { parseAction, parseNetworkDecision } from './validate'
import { expect, it } from 'vitest'

it('requires an explicit boolean decision and never accepts approval as a browser action', () => {
  expect(parseNetworkDecision({ origin: 'https://192.168.50.1:8443', allow: true })).toEqual({ origin: 'https://192.168.50.1:8443', allow: true })
  expect(() => parseNetworkDecision({ origin: 'https://192.168.50.1:8443', allow: 'true' })).toThrow()
  expect(() => parseNetworkDecision({ allow: true })).toThrow()
  expect(() => parseAction({ type: 'network_access', origin: 'https://192.168.50.1:8443', allow: true })).toThrow()
})

it('accepts credential listing and filling with refs or coordinates', () => {
  expect(parseAction({ type: 'credential_list' })).toEqual({ type: 'credential_list', query: '' })
  expect(parseAction({ type: 'credential_list', query: 'Shop' })).toEqual({ type: 'credential_list', query: 'Shop' })
  expect(parseAction({ type: 'credential_fill', credentialId: 'credential_1', field: 'password', target: { ref: 'ref_1' } })).toEqual({ type: 'credential_fill', credentialId: 'credential_1', field: 'password', target: { ref: 'ref_1' } })
  expect(parseAction({ type: 'credential_fill', credentialId: 'credential_1', field: 'totp', target: { x: 100, y: 200 } })).toMatchObject({ field: 'totp', target: { x: 100, y: 200 } })
})

it('rejects arbitrary secret fields and malformed credential actions', () => {
  expect(() => parseAction({ type: 'credential_fill', credentialId: 'credential_1', field: 'note', target: { ref: 'ref_1' } })).toThrow()
  expect(() => parseAction({ type: 'credential_fill', credentialId: 'credential_1', field: 'password', target: { x: '100', y: 200 } })).toThrow()
  expect(() => parseAction({ type: 'credential_list', query: 42 })).toThrow()
})
