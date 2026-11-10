import { parseKeyChord, splitKeySequence, toPlaywrightModifier } from './keys'
import { describe, expect, it } from 'vitest'

describe('parseKeyChord', () => {
  it('maps xdotool style names', () => {
    expect(parseKeyChord('Return')).toBe('Enter')
    expect(parseKeyChord('enter')).toBe('Enter')
    expect(parseKeyChord('esc')).toBe('Escape')
    expect(parseKeyChord('BackSpace')).toBe('Backspace')
    expect(parseKeyChord('Page_Down')).toBe('PageDown')
    expect(parseKeyChord('Page_Up')).toBe('PageUp')
    expect(parseKeyChord('Up')).toBe('ArrowUp')
    expect(parseKeyChord('left')).toBe('ArrowLeft')
    expect(parseKeyChord('space')).toBe('Space')
    expect(parseKeyChord('f5')).toBe('F5')
    expect(parseKeyChord('Tab')).toBe('Tab')
    expect(parseKeyChord('Delete')).toBe('Delete')
  })

  it('maps modifiers, ctrl meaning the platform primary modifier', () => {
    expect(parseKeyChord('ctrl+a')).toBe('ControlOrMeta+a')
    expect(parseKeyChord('Control+Shift+t')).toBe('ControlOrMeta+Shift+t')
    expect(parseKeyChord('super+c')).toBe('Meta+c')
    expect(parseKeyChord('cmd+v')).toBe('Meta+v')
    expect(parseKeyChord('alt+Left')).toBe('Alt+ArrowLeft')
    expect(parseKeyChord('option+f')).toBe('Alt+f')
  })

  it('keeps single characters and handles plus as a key', () => {
    expect(parseKeyChord('a')).toBe('a')
    expect(parseKeyChord('A')).toBe('A')
    expect(parseKeyChord('+')).toBe('+')
    expect(parseKeyChord('ctrl++')).toBe('ControlOrMeta++')
    expect(parseKeyChord('ctrl+plus')).toBe('ControlOrMeta++')
    expect(parseKeyChord('minus')).toBe('-')
  })

  it('accepts uppercase OpenAI style names joined with plus', () => {
    expect(parseKeyChord('CTRL+A')).toBe('ControlOrMeta+a')
    expect(parseKeyChord('ENTER')).toBe('Enter')
    expect(parseKeyChord('ARROWLEFT')).toBe('ArrowLeft')
    expect(parseKeyChord('arrowleft')).toBe('ArrowLeft')
    expect(parseKeyChord('PAGEDOWN')).toBe('PageDown')
    expect(parseKeyChord('ESC')).toBe('Escape')
    expect(parseKeyChord('SPACE')).toBe('Space')
    expect(parseKeyChord('BACKSPACE')).toBe('Backspace')
    expect(parseKeyChord('DELETE')).toBe('Delete')
    expect(parseKeyChord('TAB')).toBe('Tab')
    expect(parseKeyChord('HOME')).toBe('Home')
    expect(parseKeyChord('END')).toBe('End')
    expect(parseKeyChord('CMD+SHIFT+Z')).toBe('Meta+Shift+z')
    expect(parseKeyChord('SUPER+c')).toBe('Meta+c')
  })

  it('treats a lone modifier as a key press', () => {
    expect(parseKeyChord('CMD')).toBe('Meta')
    expect(parseKeyChord('META')).toBe('Meta')
    expect(parseKeyChord('ctrl')).toBe('ControlOrMeta')
    expect(parseKeyChord('SHIFT')).toBe('Shift')
  })

  it('passes unknown names through', () => {
    expect(parseKeyChord('CapsLock')).toBe('CapsLock')
  })

  it('rejects empty chords', () => {
    expect(() => parseKeyChord('')).toThrow()
    expect(() => parseKeyChord('ctrl+')).toThrow()
  })
})

describe('splitKeySequence', () => {
  it('splits whitespace separated chords', () => {
    expect(splitKeySequence(['ctrl+a Delete', 'Return'])).toEqual(['ctrl+a', 'Delete', 'Return'])
  })

  it('keeps a literal space key', () => {
    expect(splitKeySequence([' '])).toEqual(['space'])
  })
})

describe('toPlaywrightModifier', () => {
  it('maps protocol modifiers', () => {
    expect(toPlaywrightModifier('ctrl')).toBe('ControlOrMeta')
    expect(toPlaywrightModifier('meta')).toBe('Meta')
    expect(toPlaywrightModifier('shift')).toBe('Shift')
    expect(toPlaywrightModifier('alt')).toBe('Alt')
  })
})
