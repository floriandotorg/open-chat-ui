export const LANGUAGES = [
  { code: 'de', label: 'Deutsch', name: 'German' },
  { code: 'en', label: 'English', name: 'English' },
  { code: 'pt-PT', label: 'Português (Portugal)', name: 'European Portuguese' },
  { code: 'th', label: 'ไทย', name: 'Thai' },
  { code: 'ja', label: '日本語', name: 'Japanese' },
  { code: 'nl', label: 'Nederlands', name: 'Dutch' },
  { code: 'es', label: 'Español', name: 'Spanish' },
]

export interface TranslationContext {
  id: string
  title: string
  content: string
}

export const DEFAULT_CONTEXTS: TranslationContext[] = [
  { id: 'everyday', title: 'Everyday conversation', content: 'A casual everyday conversation. Keep the tone natural and friendly.' },
  { id: 'personal', title: 'Close relationships', content: 'A personal conversation with someone close. Preserve warmth, vulnerability, and emotional intensity.' },
  { id: 'travel', title: 'Travel and daily life', content: 'Speaking with local people while travelling. Use polite, approachable language.' },
  { id: 'work', title: 'Work', content: 'A professional conversation. Be respectful and clear without sounding stiff.' },
]

export const parseContexts = (value: unknown): TranslationContext[] | null => {
  if (!Array.isArray(value) || value.length > 20) {
    return null
  }
  const contexts: TranslationContext[] = []
  for (const entry of value) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.id !== 'string' ||
      typeof entry.title !== 'string' ||
      typeof entry.content !== 'string' ||
      !entry.id ||
      !entry.title.trim() ||
      entry.id.length > 100 ||
      entry.title.length > 100 ||
      entry.content.length > 4000 ||
      contexts.some(context => context.id === entry.id)
    ) {
      return null
    }
    contexts.push({ id: entry.id, title: entry.title, content: entry.content })
  }
  return contexts
}

export type SpeakerGender = 'unspecified' | 'female' | 'male' | 'neutral'
export const SPEAKER_GENDERS: SpeakerGender[] = ['unspecified', 'female', 'male', 'neutral']

export const isSpeakerGender = (value: unknown): value is SpeakerGender => SPEAKER_GENDERS.some(gender => gender === value)

export interface ContextNote {
  phrase: string
  source: string
  target: string
}

export const isContextNote = (value: unknown): value is ContextNote => {
  if (typeof value !== 'object' || value === null || !('phrase' in value) || !('source' in value) || !('target' in value)) {
    return false
  }
  return typeof value.phrase === 'string' && Boolean(value.phrase.trim()) && value.phrase.length <= 100 && typeof value.source === 'string' && Boolean(value.source.trim()) && value.source.length <= 320 && typeof value.target === 'string' && Boolean(value.target.trim()) && value.target.length <= 320
}

export type TranslationStage = 'translation' | 'back' | 'note'
export type TranslationEvent = { type: 'translation' | 'back'; text: string } | { type: 'note'; notes: ContextNote[] } | { type: 'error'; stage: TranslationStage; text: string } | { type: 'done' }

export const isTranslationEvent = (value: unknown): value is TranslationEvent => {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }
  if (value.type === 'done') {
    return true
  }
  if (value.type === 'note') {
    return 'notes' in value && Array.isArray(value.notes) && value.notes.length <= 3 && value.notes.every(isContextNote)
  }
  if (!('text' in value) || typeof value.text !== 'string') {
    return false
  }
  return value.type === 'translation' || value.type === 'back' || (value.type === 'error' && 'stage' in value && (value.stage === 'translation' || value.stage === 'back' || value.stage === 'note'))
}
