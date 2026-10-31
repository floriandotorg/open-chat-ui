import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startDevPanes } from './orca-dev.mjs'

const root = "/worktrees/Open Chat's workspace"

const mockOrca = (respond = () => undefined) => {
  const calls = []
  const run = (command, args, options) => {
    assert.equal(command, '/custom/orca')
    assert.equal(options.cwd, root)
    calls.push(args)
    return JSON.stringify(respond(args) ?? { ok: true, result: { split: { handle: args.includes('mosh hello-email-space') ? 'mosh' : 'pocketbase' } } })
  }
  return { calls, run }
}

test('development puts Vite and PocketBase above a full width mosh pane without creating a tab or sending shell input', () => {
  const { calls, run } = mockOrca()
  startDevPanes({ root, terminal: 'vite', cli: '/custom/orca', run })

  assert.deepEqual(calls, [
    ['terminal', 'rename', '--terminal', 'vite', '--title', 'Development', '--json'],
    ['terminal', 'set-pane-title', '--terminal', 'vite', '--title', 'Vite', '--json'],
    ['terminal', 'split', '--terminal', 'vite', '--direction', 'horizontal', '--command', 'mosh hello-email-space', '--json'],
    ['terminal', 'set-pane-title', '--terminal', 'mosh', '--title', 'mosh', '--json'],
    ['terminal', 'split', '--terminal', 'vite', '--direction', 'vertical', '--command', "cd '/worktrees/Open Chat'\\''s workspace' && bun run pb:serve", '--json'],
    ['terminal', 'set-pane-title', '--terminal', 'pocketbase', '--title', 'PocketBase', '--json'],
  ])
})

test('a missing invoking terminal stops before calling Orca', () => {
  const { calls, run } = mockOrca()
  assert.throws(() => startDevPanes({ root, terminal: '', cli: '/custom/orca', run }), /inside an Orca terminal/)
  assert.equal(calls.length, 0)
})

test('an invalid invoking terminal stops without splitting the active terminal', () => {
  const { calls, run } = mockOrca(() => ({ ok: false, error: { message: 'Terminal not found' } }))
  assert.throws(() => startDevPanes({ root, terminal: 'vite', cli: '/custom/orca', run }), /Terminal not found/)
  assert.equal(calls.length, 1)
})

test('a split failure stops without retrying or closing services', () => {
  const { calls, run } = mockOrca(args => {
    if (args[1] === 'split') {
      return { ok: false, error: { message: 'Split timed out' } }
    }
  })
  assert.throws(() => startDevPanes({ root, terminal: 'vite', cli: '/custom/orca', run }), /Split timed out/)
  assert.equal(calls.filter(args => args[1] === 'split').length, 1)
  assert.equal(calls.at(-1)[1], 'split')
})

test('a missing split handle stops instead of targeting the active pane', () => {
  const { calls, run } = mockOrca(args => {
    if (args[1] === 'split') {
      return { ok: true, result: { split: {} } }
    }
  })
  assert.throws(() => startDevPanes({ root, terminal: 'vite', cli: '/custom/orca', run }), /terminal handle/)
  assert.equal(calls.at(-1)[1], 'split')
})
