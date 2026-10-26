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
  note: string
}

export interface TranslationNotes {
  sender: ContextNote[]
  recipient: ContextNote[]
}

export const MAX_NOTES_PER_SIDE = 3

export const isContextNote = (value: unknown): value is ContextNote => {
  if (typeof value !== 'object' || value === null || !('phrase' in value) || !('note' in value)) {
    return false
  }
  return typeof value.phrase === 'string' && Boolean(value.phrase.trim()) && value.phrase.length <= 100 && typeof value.note === 'string' && Boolean(value.note.trim()) && value.note.length <= 400
}

const isNoteList = (value: unknown): value is ContextNote[] => Array.isArray(value) && value.length <= MAX_NOTES_PER_SIDE && value.every(isContextNote)

export const isTranslationNotes = (value: unknown): value is TranslationNotes => typeof value === 'object' && value !== null && 'sender' in value && 'recipient' in value && isNoteList(value.sender) && isNoteList(value.recipient)

export type TranslationStage = 'translation' | 'back' | 'notes'
export type TranslationEvent = { type: 'translation' | 'back'; text: string } | { type: 'notes'; notes: TranslationNotes } | { type: 'error'; stage: TranslationStage; text: string } | { type: 'done' }

export const isTranslationEvent = (value: unknown): value is TranslationEvent => {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }
  if (value.type === 'done') {
    return true
  }
  if (value.type === 'notes') {
    return 'notes' in value && isTranslationNotes(value.notes)
  }
  if (!('text' in value) || typeof value.text !== 'string') {
    return false
  }
  return value.type === 'translation' || value.type === 'back' || (value.type === 'error' && 'stage' in value && (value.stage === 'translation' || value.stage === 'back' || value.stage === 'notes'))
}
