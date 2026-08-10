import { mapSystemPrompt, mapUserSettings, type UserSettings } from '$lib/db-mappers'
import { pbClient } from '$lib/pb-client'
import type { SystemPrompt } from '$lib/types'
import { browser } from '$app/environment'

export const createSettingsStore = (initial: { settings: UserSettings | null; systemPrompts: SystemPrompt[] }) => {
  // svelte-ignore state_referenced_locally
  let settings = $state<UserSettings | null>(initial.settings)
  // svelte-ignore state_referenced_locally
  let systemPrompts = $state<SystemPrompt[]>([...initial.systemPrompts])

  const seed = (next: { settings: UserSettings | null; systemPrompts: SystemPrompt[] }) => {
    settings = next.settings
    systemPrompts = [...next.systemPrompts]
  }

  const upsertPrompt = (prompt: SystemPrompt) => {
    systemPrompts = systemPrompts.some(p => p.id === prompt.id) ? systemPrompts.map(p => (p.id === prompt.id ? prompt : p)) : [...systemPrompts, prompt]
  }
  const removePrompt = (id: string) => {
    systemPrompts = systemPrompts.filter(p => p.id !== id)
  }
  const replaceSettings = (next: UserSettings | null) => {
    settings = next
  }

  let settingsUnsub: (() => void) | null = null
  let promptsUnsub: (() => void) | null = null
  let cancelled = false

  const subscribe = async () => {
    if (!browser || settingsUnsub || promptsUnsub) return
    cancelled = false
    void (async () => {
      try {
        settingsUnsub = await pbClient.collection('user_settings').subscribe('*', e => {
          if (cancelled) return
          if (e.action === 'delete') {
            settings = null
          } else {
            settings = mapUserSettings(e.record)
          }
        })
      } catch (err) {
        console.warn('[realtime] user_settings subscribe failed', err)
      }
      if (cancelled) {
        settingsUnsub?.()
        settingsUnsub = null
      }
    })()
    void (async () => {
      try {
        promptsUnsub = await pbClient.collection('system_prompts').subscribe('*', e => {
          if (cancelled) return
          if (e.action === 'delete') removePrompt(e.record.id)
          else upsertPrompt(mapSystemPrompt(e.record))
        })
      } catch (err) {
        console.warn('[realtime] system_prompts subscribe failed', err)
      }
      if (cancelled) {
        promptsUnsub?.()
        promptsUnsub = null
      }
    })()
  }

  const unsubscribe = () => {
    cancelled = true
    settingsUnsub?.()
    promptsUnsub?.()
    settingsUnsub = null
    promptsUnsub = null
  }

  const resync = async () => {
    if (!browser || cancelled) return
    const userId = pbClient.authStore.record?.id
    if (!userId) return
    try {
      const filter = pbClient.filter('user = {:u}', { u: userId })
      const [settingsRow, promptRows] = await Promise.all([
        pbClient
          .collection('user_settings')
          .getFirstListItem(filter)
          .catch(() => null),
        pbClient.collection('system_prompts').getFullList({ filter, sort: 'createdAt' }),
      ])
      if (cancelled) return
      seed({
        settings: settingsRow ? mapUserSettings(settingsRow) : null,
        systemPrompts: promptRows.map(mapSystemPrompt),
      })
    } catch (err) {
      console.warn('[realtime] settings resync failed', err)
    }
  }

  return {
    get settings() {
      return settings
    },
    get systemPrompts() {
      return systemPrompts
    },
    seed,
    upsertPrompt,
    removePrompt,
    replaceSettings,
    subscribe,
    unsubscribe,
    resync,
  }
}
