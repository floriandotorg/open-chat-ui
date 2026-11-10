import type { ProviderInfo } from '#lib/types.ts'
import ChatGPTPlanForm from './ChatGPTPlanForm.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const SIGN_IN_URL = 'https://auth.openai.com/api/accounts/authorize?state=abc'
const PENDING_SIGN_IN_KEY = 'chatgpt-plan-pending-sign-in'

let instance: Record<string, unknown> | undefined

const provider = (): ProviderInfo => ({ id: 'chatgpt', name: 'ChatGPT plan', hasKey: false })

const render = () => {
  instance = mount(ChatGPTPlanForm, { target: document.body, props: { provider: provider(), account: null } })
  flushSync()
}

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')

const buttonByText = (label: string) => {
  const button = [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === label)
  if (!button) {
    throw new Error(`No button "${label}"`)
  }
  return button
}

const remount = async () => {
  if (instance) {
    await unmount(instance)
  }
  document.body.innerHTML = ''
  render()
}

const stubStandalone = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)', addEventListener: () => {}, removeEventListener: () => {} }))

const stubSignInStart = () => {
  const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Response.json({ url: SIGN_IN_URL, callbackReachesApp: false })
    }
    return Response.json({ account: null })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(async () => {
  if (instance) {
    await unmount(instance)
  }
  instance = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

test('in an installed web app the sign-in page opens through a link instead of a blank popup', async () => {
  stubStandalone()
  stubSignInStart()
  const openSpy = vi.spyOn(window, 'open')
  render()

  buttonByText('Continue with ChatGPT').click()

  await vi.waitFor(() => {
    if (!document.querySelector('a[target="_blank"]')) {
      throw new Error('link not rendered yet')
    }
  })
  expect(openSpy).not.toHaveBeenCalled()
  expect(document.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(SIGN_IN_URL)
  expect(text()).toContain('copy the whole error text')
})

test('the paste step survives a reload while the sign-in is pending', async () => {
  stubStandalone()
  stubSignInStart()
  render()
  buttonByText('Continue with ChatGPT').click()
  await vi.waitFor(() => {
    if (!localStorage.getItem(PENDING_SIGN_IN_KEY)) {
      throw new Error('pending sign-in not stored yet')
    }
  })

  await remount()

  expect(text()).toContain('Paste and connect')
  expect(document.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(SIGN_IN_URL)
})

test('an expired pending sign-in is not restored', async () => {
  localStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ url: SIGN_IN_URL, reachesApp: false, expiresAt: Date.now() - 1 }))
  render()

  expect(text()).not.toContain('Paste and connect')
  expect(localStorage.getItem(PENDING_SIGN_IN_KEY)).toBeNull()
})

test('paste and connect submits the callback address from the clipboard', async () => {
  const callbackUrl = 'http://127.0.0.1:1455/auth/callback?code=xyz&state=abc'
  localStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ url: SIGN_IN_URL, reachesApp: false, expiresAt: Date.now() + 60_000 }))
  vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue(`  ${callbackUrl}\n`)
  const fetchMock = vi.fn(async () => Response.json({ email: 'me@example.com' }))
  vi.stubGlobal('fetch', fetchMock)
  render()

  buttonByText('Paste and connect').click()

  await vi.waitFor(() => {
    if (!text().includes('Connected')) {
      throw new Error('not connected yet')
    }
  })
  expect(fetchMock).toHaveBeenCalledWith('/api/chatgpt/callback', expect.objectContaining({ method: 'POST', body: JSON.stringify({ callbackUrl }) }))
  expect(localStorage.getItem(PENDING_SIGN_IN_KEY)).toBeNull()
})
