import { computerActionToBrowser, createRunner, keypressToChord } from '#lib/server/browser/agent-openai.ts'
import { createFakeHost, fakeState, okResult } from '#lib/server/browser/fake-host.ts'
import { createTaskSession } from '#lib/server/browser/task-session.ts'
import { describe, expect, it } from 'vitest'

describe('keypressToChord', () => {
  it('joins keys into a lowercase chord', () => {
    expect(keypressToChord(['CTRL', 'A'])).toBe('ctrl+a')
    expect(keypressToChord(['ENTER'])).toBe('enter')
  })

  it('names a literal plus key', () => {
    expect(keypressToChord(['CTRL', '+'])).toBe('ctrl+plus')
  })
})

describe('computerActionToBrowser', () => {
  it('maps clicks with buttons and held keys', () => {
    expect(computerActionToBrowser({ type: 'click', button: 'left', x: 5, y: 6, keys: ['SHIFT'] })).toEqual({ type: 'click', target: { x: 5, y: 6 }, button: 'left', count: 1, modifiers: ['shift'] })
    expect(computerActionToBrowser({ type: 'click', button: 'wheel', x: 1, y: 2 })).toEqual({ type: 'click', target: { x: 1, y: 2 }, button: 'middle', count: 1 })
  })

  it('maps back and forward mouse buttons to history', () => {
    expect(computerActionToBrowser({ type: 'click', button: 'back', x: 0, y: 0 })).toEqual({ type: 'history', direction: 'back' })
  })

  it('maps double clicks, drags, moves and scrolls', () => {
    expect(computerActionToBrowser({ type: 'double_click', x: 3, y: 4, keys: null })).toEqual({ type: 'click', target: { x: 3, y: 4 }, button: 'left', count: 2 })
    expect(
      computerActionToBrowser({
        type: 'drag',
        path: [
          { x: 1, y: 1 },
          { x: 9, y: 9 },
        ],
      }),
    ).toEqual({
      type: 'drag',
      path: [
        { x: 1, y: 1 },
        { x: 9, y: 9 },
      ],
    })
    expect(computerActionToBrowser({ type: 'move', x: 7, y: 8 })).toEqual({ type: 'hover', target: { x: 7, y: 8 } })
    expect(computerActionToBrowser({ type: 'scroll', x: 10, y: 20, scroll_x: 0, scroll_y: 300 })).toEqual({ type: 'scroll', x: 10, y: 20, deltaX: 0, deltaY: 300 })
  })

  it('maps typing, keys and waits', () => {
    expect(computerActionToBrowser({ type: 'type', text: 'hello' })).toEqual({ type: 'type', text: 'hello' })
    expect(computerActionToBrowser({ type: 'keypress', keys: ['CTRL', 'C'] })).toEqual({ type: 'key', keys: ['ctrl+c'] })
    expect(computerActionToBrowser({ type: 'wait' })).toEqual({ type: 'wait', ms: 2000 })
  })

  it('skips screenshots because every turn ends with one', () => {
    expect(computerActionToBrowser({ type: 'screenshot' })).toBeNull()
  })
})

describe('createRunner', () => {
  it('runs computer calls that omit pending safety checks', async () => {
    const fake = createFakeHost(action => okResult(fakeState(), action.type === 'screenshot' ? { image: { base64: 'aGk=', mediaType: 'image/jpeg' } } : {}))
    const session = createTaskSession({ host: fake.host, sessionId: 's1', initialState: fakeState(), files: [] })
    const call = JSON.parse(JSON.stringify({ type: 'computer_call', id: 'cu1', call_id: 'call1', status: 'completed', actions: [{ type: 'click', button: 'left', x: 1, y: 2 }] }))
    const [output] = await createRunner(session).runComputerCall(call)
    expect(output).toEqual({ type: 'computer_call_output', call_id: 'call1', output: { type: 'computer_screenshot', image_url: 'data:image/jpeg;base64,aGk=' } })
  })
})
