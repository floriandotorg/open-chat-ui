import type { BrowserModifier } from '#lib/browser-protocol.ts'

const KEY_NAMES: Record<string, string> = {
  return: 'Enter',
  enter: 'Enter',
  kp_enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  backspace: 'Backspace',
  tab: 'Tab',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  page_up: 'PageUp',
  pageup: 'PageUp',
  prior: 'PageUp',
  page_down: 'PageDown',
  pagedown: 'PageDown',
  next: 'PageDown',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  space: 'Space',
  plus: '+',
  minus: '-',
}

const MODIFIER_NAMES: Record<string, string> = {
  shift: 'Shift',
  ctrl: 'ControlOrMeta',
  control: 'ControlOrMeta',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  super: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  win: 'Meta',
  windows: 'Meta',
}

const PROTOCOL_MODIFIERS: Record<BrowserModifier, string> = { shift: 'Shift', ctrl: 'ControlOrMeta', alt: 'Alt', meta: 'Meta' }

export const toPlaywrightModifier = (modifier: BrowserModifier): string => PROTOCOL_MODIFIERS[modifier]

const toKeyName = (name: string, withModifiers: boolean): string => {
  if (name.length === 1) {
    return withModifiers ? name.toLowerCase() : name
  }
  const lower = name.toLowerCase()
  if (/^f([1-9]|1[0-2])$/.test(lower)) {
    return lower.toUpperCase()
  }
  return KEY_NAMES[lower] ?? MODIFIER_NAMES[lower] ?? name
}

export const parseKeyChord = (chord: string): string => {
  if (chord === '+') {
    return '+'
  }
  const endsWithPlusKey = chord.endsWith('++')
  const parts = (endsWithPlusKey ? chord.slice(0, -2) : chord).split('+')
  const key = endsWithPlusKey ? '+' : parts.pop()
  if (!key) {
    throw new Error(`Invalid key "${chord}"`)
  }
  const modifiers = parts.map(part => {
    const modifier = MODIFIER_NAMES[part.toLowerCase()]
    if (!modifier) {
      throw new Error(`Unknown modifier "${part}" in "${chord}"`)
    }
    return modifier
  })
  return [...modifiers, toKeyName(key, modifiers.length > 0)].join('+')
}

export const splitKeySequence = (keys: string[]): string[] => keys.flatMap(entry => (entry === ' ' ? ['space'] : entry.split(/\s+/).filter(Boolean)))
