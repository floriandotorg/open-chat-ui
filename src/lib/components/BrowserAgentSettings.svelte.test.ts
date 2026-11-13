import { mapUserSettings } from '#lib/db-mappers.ts'
import type { OpenAIConnection } from '#lib/model-connection.ts'
import type { ProviderInfo } from '#lib/types.ts'
import BrowserAgentSettings from './BrowserAgentSettings.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'

let component: ReturnType<typeof mount> | undefined
let target: HTMLDivElement | undefined

const providers: ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', hasKey: false },
  { id: 'chatgpt', name: 'ChatGPT plan', hasKey: true },
  { id: 'anthropic', name: 'Anthropic', hasKey: false },
]

const render = (connection: OpenAIConnection, available = providers) => {
  const settings = $state(mapUserSettings({ id: 'settings-1', collectionId: 'user_settings', collectionName: 'user_settings', user: 'user-1', openaiConnection: connection, browserHostUrl: 'http://127.0.0.1:9330', updatedAt: '' }))
  target = document.createElement('div')
  document.body.append(target)
  flushSync(() => {
    component = mount(BrowserAgentSettings, {
      target: target ?? document.body,
      props: { settings, providers: available, hostKey: undefined },
    })
  })
  return settings
}

afterEach(async () => {
  if (component) {
    await unmount(component)
  }
  target?.remove()
  vi.unstubAllGlobals()
})

it('offers OpenAI models using the connected subscription without an API key', async () => {
  const fetchMock = vi.fn(async () => Response.json([{ id: 'openai/gpt-5.4', name: 'GPT 5.4', capabilities: ['vision', 'tool_use'] }]))
  vi.stubGlobal('fetch', fetchMock)
  render('subscription')
  await vi.waitFor(() => expect(target?.querySelector('option[value="openai/gpt-5.4"]')?.textContent).toBe('GPT 5.4'))
  expect(fetchMock).toHaveBeenCalledWith('/api/models/manage?provider=openai')
  expect(target?.textContent).toContain('OpenAI browser tasks use your connected ChatGPT subscription')
  expect(target?.textContent).not.toContain('do not support')
  expect(target?.textContent).not.toContain('first.')
  const select = target?.querySelector('select')
  if (!select) {
    throw new Error('Missing model selector')
  }
  select.value = 'openai/gpt-5.4'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
  target?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ browserAgentModel: 'openai/gpt-5.4', browserHostUrl: 'http://127.0.0.1:9330' }) })))
})

it('does not treat a subscription as an API key in API mode', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render('api')
  flushSync()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(target?.querySelectorAll('option').length).toBe(1)
  expect(target?.textContent).toContain('Connect a ChatGPT subscription or add an Anthropic or OpenAI API key')
})

it('reloads models when switching connections and ignores stale responses', async () => {
  let finish: ((response: Response) => void) | undefined
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>(resolve => {
        finish = resolve
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const settings = render('api')
  expect(fetchMock).not.toHaveBeenCalled()
  settings.openaiConnection = 'subscription'
  flushSync()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/models/manage?provider=openai'))
  settings.openaiConnection = 'api'
  flushSync()
  finish?.(Response.json([{ id: 'openai/gpt-5.4', name: 'GPT 5.4' }]))
  await Promise.resolve()
  await Promise.resolve()
  flushSync()
  expect(target?.querySelectorAll('option').length).toBe(1)
})

it('never offers paid OpenAI models when the selected subscription is missing', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render('subscription', [
    { id: 'openai', name: 'OpenAI', hasKey: true },
    { id: 'chatgpt', name: 'ChatGPT plan', hasKey: false },
  ])
  flushSync()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(target?.querySelectorAll('option').length).toBe(1)
})
