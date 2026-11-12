import OpenAIConnectionForm from './OpenAIConnectionForm.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}), replaceState: vi.fn() }))

let component: ReturnType<typeof mount> | undefined
let target: HTMLDivElement | undefined

afterEach(async () => {
  if (component) {
    await unmount(component)
  }
  target?.remove()
  vi.unstubAllGlobals()
})

const render = () => {
  target = document.createElement('div')
  document.body.append(target)
  flushSync(() => {
    component = mount(OpenAIConnectionForm, {
      target: target ?? document.body,
      props: { provider: { id: 'openai', name: 'OpenAI', hasKey: true }, subscriptionProvider: { id: 'chatgpt', name: 'ChatGPT plan', hasKey: true }, account: { email: 'test@example.com' }, connection: 'api' },
    })
  })
  return [...target.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
}

it('shows connection setup separately and saves the selected subscription', async () => {
  const fetchMock = vi.fn(async () => Response.json({ openaiConnection: 'subscription' }))
  vi.stubGlobal('fetch', fetchMock)
  const [api, subscription] = render()
  expect(api.getAttribute('aria-pressed')).toBe('true')
  expect(target?.textContent).toContain('ChatGPT subscription connected as test@example.com')
  expect(target?.textContent).toContain('Remaining allowance: check ChatGPT usage')
  subscription.click()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ openaiConnection: 'subscription' }) })))
  await vi.waitFor(() => expect(subscription.getAttribute('aria-pressed')).toBe('true'))
  expect(target?.textContent).toContain('Requests never fall back to the paid API')
})

it('shows a failed save and restores the API selection', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ message: 'Save failed' }, { status: 500 }))
  const [api, subscription] = render()
  subscription.click()
  await vi.waitFor(() => expect(target?.querySelector('[role="alert"]')?.textContent).toBe('Save failed'))
  expect(api.getAttribute('aria-pressed')).toBe('true')
  expect(subscription.getAttribute('aria-pressed')).toBe('false')
})
