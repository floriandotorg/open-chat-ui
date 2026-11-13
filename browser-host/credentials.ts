import type { BrowserActionOutcome, BrowserCredentialField, BrowserState } from '#lib/browser-protocol.ts'
import type { ProtonItem, ProtonPass } from './proton-pass'

const MAX_LIST_ITEMS = 50

export const createCredentialSession = () => {
  const items = new Map<string, ProtonItem>()
  const secrets = new Set<string>()

  const list = async (provider: ProtonPass, query: string) => {
    const available = await provider.list()
    const credentials = available
      .map(item => {
        const existing = [...items].find(([, candidate]) => candidate.shareId === item.shareId && candidate.itemId === item.itemId)
        const id = existing?.[0] ?? `credential_${items.size + 1}`
        items.set(id, item)
        return { id, title: item.title, share: item.share }
      })
      .filter(item => `${item.title} ${item.share}`.toLowerCase().includes(query.toLowerCase().trim()))
    return { credentials: credentials.slice(0, MAX_LIST_ITEMS), total: credentials.length }
  }

  const fill = async (provider: ProtonPass, id: string, field: BrowserCredentialField, write: (value: string) => Promise<void>) => {
    const item = items.get(id)
    if (!item) {
      throw new Error('List credentials first and use an identifier from this browser session.')
    }
    const value = await provider.read(item, field)
    if (!value) {
      throw new Error('The selected credential field is empty. Try email instead of username, or ask the user.')
    }
    secrets.add(value)
    try {
      await write(value)
    } catch {
      throw new Error('Could not fill the credential field. Refresh the page observation and select an editable input.')
    }
  }

  const redact = (text: string): string => {
    if (!secrets.size) {
      return text
    }
    const pattern = [...secrets]
      .sort((a, b) => b.length - a.length)
      .map(secret => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    return text.replace(new RegExp(pattern, 'g'), '[REDACTED]')
  }

  const redactOutcome = (outcome: BrowserActionOutcome): BrowserActionOutcome => (outcome.ok ? { ...outcome, ...(outcome.text !== undefined ? { text: redact(outcome.text) } : {}) } : { ...outcome, error: redact(outcome.error) })

  const redactState = (state: BrowserState): BrowserState => ({ ...state, url: redact(state.url), tabs: state.tabs.map(tab => ({ ...tab, title: redact(tab.title), url: redact(tab.url) })) })

  return { list, fill, redact, redactOutcome, redactState }
}

const sessions = new WeakMap<object, ReturnType<typeof createCredentialSession>>()

export const credentialsFor = (session: object) => {
  let credentials = sessions.get(session)
  if (!credentials) {
    credentials = createCredentialSession()
    sessions.set(session, credentials)
  }
  return credentials
}
