import type { UserSettings } from '#lib/db-mappers.ts'
import { connectionModelRef, parseOpenAIConnection } from '#lib/model-connection.ts'
import { parseModelRef } from '#lib/model-ref.ts'
import { getDecryptedKey } from '#lib/server/api-key.ts'
import { type BrowserHost, createBrowserHost } from '#lib/server/browser/host-client.ts'
import { mapUserSettings } from '#lib/server/db/records.ts'
import { getFirstOrNull, pb } from '#lib/server/pb.ts'

export const BROWSER_HOST_KEY = 'browser-host'

export type BrowserAgentProvider = 'anthropic' | 'openai' | 'chatgpt'

export interface BrowserAgentConfig {
  provider: BrowserAgentProvider
  model: string
  modelRef: string
  apiKey: string
  host: BrowserHost
}

const toProvider = (provider: string): BrowserAgentProvider | null => (provider === 'anthropic' || provider === 'openai' || provider === 'chatgpt' ? provider : null)

export const isBrowserAgentModel = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 500 || !value.includes('/')) {
    return false
  }
  const { provider, model } = parseModelRef(value)
  return !!toProvider(provider) && model.length > 0
}

export const isBrowserAgentConfigured = (settings: UserSettings | null | undefined): boolean => !!settings?.browserHostUrl && isBrowserAgentModel(settings.browserAgentModel)

const loadSettings = (userId: string) =>
  getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )

export const loadBrowserHost = async (userId: string): Promise<BrowserHost | { error: string }> => {
  const settings = await loadSettings(userId)
  if (!settings?.browserHostUrl) {
    return { error: 'Add the browser host URL in Settings > Tools.' }
  }
  const token = await getDecryptedKey(userId, BROWSER_HOST_KEY)
  if (!token) {
    return { error: 'Add the browser host token in Settings > Tools.' }
  }
  return createBrowserHost({ url: settings.browserHostUrl, token })
}

export const loadBrowserAgentConfig = async (userId: string): Promise<BrowserAgentConfig | { error: string }> => {
  const settings = await loadSettings(userId)
  if (!isBrowserAgentModel(settings?.browserAgentModel)) {
    return { error: 'Choose a browser agent model in Settings > Tools.' }
  }
  const modelRef = connectionModelRef(settings.browserAgentModel, parseOpenAIConnection(settings.openaiConnection))
  const { provider: rawProvider, model } = parseModelRef(modelRef)
  const provider = toProvider(rawProvider)
  if (!provider) {
    return { error: 'The browser agent model must be an Anthropic or OpenAI model.' }
  }
  const [host, apiKey] = await Promise.all([loadBrowserHost(userId), getDecryptedKey(userId, provider)])
  if ('error' in host) {
    return host
  }
  if (!apiKey) {
    return { error: provider === 'chatgpt' ? 'Connect your ChatGPT subscription in Settings > Connections to use the browser agent.' : `Add an ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key to use the browser agent.` }
  }
  return { provider, model, modelRef, apiKey, host }
}
