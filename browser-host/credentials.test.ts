import { createCredentialSession } from './credentials'
import type { ProtonPass } from './proton-pass'
import { expect, it, vi } from 'vitest'

const item = { shareId: 'share-1', itemId: 'item-1', title: 'Shopping account', share: 'Automation' }
const setup = () => {
  const provider: ProtonPass = { list: vi.fn(async () => [item]), read: vi.fn(async () => 'private-password') }
  return { provider, session: createCredentialSession() }
}

it('lists opaque identifiers with metadata, filters names and keeps identifiers stable', async () => {
  const { provider, session } = setup()
  const first = await session.list(provider, 'shopping')
  expect(first.credentials).toEqual([{ id: 'credential_1', title: item.title, share: item.share }])
  expect(await session.list(provider, 'missing')).toEqual({ credentials: [], total: 0 })
  expect(await session.list(provider, '')).toEqual(first)
  expect(JSON.stringify(first)).not.toContain('share-1')
  expect(provider.read).not.toHaveBeenCalled()
})

it('fills privately and redacts values from subsequent text without altering image data', async () => {
  const { provider, session } = setup()
  await session.list(provider, '')
  const fill = vi.fn(async (_value: string) => {})
  await expect(session.fill(provider, 'credential_1', 'password', fill)).resolves.toBeUndefined()
  expect(fill).toHaveBeenCalledWith('private-password')
  expect(session.redact('value=private-password')).toBe('value=[REDACTED]')
  expect(session.redact('private-password/private-password')).toBe('[REDACTED]/[REDACTED]')
  expect(session.redactOutcome({ ok: true, text: 'private-password', image: { base64: 'private-password', mediaType: 'image/jpeg' } })).toEqual({ ok: true, text: '[REDACTED]', image: { base64: 'private-password', mediaType: 'image/jpeg' } })
  expect(session.redactOutcome({ ok: false, error: 'Page echoed private-password' })).toEqual({ ok: false, error: 'Page echoed [REDACTED]' })
  expect(session.redactState({ tabs: [{ id: 'tab_1', title: 'private-password', url: 'https://example.com/private-password' }], activeTabId: 'tab_1', url: 'https://example.com/private-password', viewport: { width: 1280, height: 800 } })).toEqual({
    tabs: [{ id: 'tab_1', title: '[REDACTED]', url: 'https://example.com/[REDACTED]' }],
    activeTabId: 'tab_1',
    url: 'https://example.com/[REDACTED]',
    viewport: { width: 1280, height: 800 },
  })
})

it('does not resolve unknown identifiers or identifiers from another browser session', async () => {
  const { provider, session } = setup()
  await session.list(provider, '')
  const other = createCredentialSession()
  await expect(other.fill(provider, 'credential_1', 'password', async () => {})).rejects.toThrow('List credentials')
  expect(provider.read).not.toHaveBeenCalled()
})

it('hides filling errors and registers secrets even when the page rejects a fill', async () => {
  const { provider, session } = setup()
  await session.list(provider, '')
  await expect(
    session.fill(provider, 'credential_1', 'password', async value => {
      throw new Error(`Page echoed ${value}`)
    }),
  ).rejects.toThrow('Could not fill the credential field')
  expect(session.redact('private-password')).toBe('[REDACTED]')
})

it('retrieves fresh secret values for every fill', async () => {
  const { provider, session } = setup()
  await session.list(provider, '')
  await session.fill(provider, 'credential_1', 'totp', async () => {})
  await session.fill(provider, 'credential_1', 'totp', async () => {})
  expect(provider.read).toHaveBeenCalledTimes(2)
})
