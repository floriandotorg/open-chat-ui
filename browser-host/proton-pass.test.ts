import { createProtonPass, type ProtonCommand, type ProtonRuntime } from './proton-pass'
import { describe, expect, it } from 'vitest'

const setup = () => {
  let n = 0
  const calls: ProtonCommand[] = []
  const removed: string[] = []
  const runtime: ProtonRuntime = {
    readToken: async () => 'private-token',
    createDirectory: async () => `/isolated/session-${++n}`,
    removeDirectory: async path => {
      removed.push(path)
    },
    run: async command => {
      calls.push(command)
      if (command.args[0] === 'share') {
        return JSON.stringify({
          shares: [
            { id: 'share-1', name: 'Automation', share_type: 1 },
            { id: 'share-2', name: 'Single item', share_type: 2 },
          ],
        })
      }
      if (command.args[1] === 'list') {
        return JSON.stringify({ items: [{ id: 'item-1', share_id: command.args[3], title: 'Shop', item_type: 'login', content: { password: 'never-return-this' }, note: 'private' }] })
      }
      return command.args[1] === 'view' ? '  password with spaces  \n' : ''
    },
  }
  return { runtime, calls, removed, provider: createProtonPass(runtime) }
}

describe('Proton Pass operations', () => {
  it('logs in and out for every retrieval without passing the token on the command line', async () => {
    const { provider, calls, removed } = setup()
    const item = { shareId: 'share-1', itemId: 'item-1', title: 'Shop', share: 'Automation' }
    expect(await provider.read(item, 'password')).toBe('  password with spaces  ')
    expect(await provider.read(item, 'username')).toBe('  password with spaces  ')
    expect(calls.map(call => call.args[0])).toEqual(['login', 'item', 'logout', 'login', 'item', 'logout'])
    expect(calls[0].env.PROTON_PASS_PERSONAL_ACCESS_TOKEN).toBe('private-token')
    expect(calls[1].env.PROTON_PASS_PERSONAL_ACCESS_TOKEN).toBeUndefined()
    expect(calls[0].env.PROTON_PASS_SESSION_DIR).not.toBe(calls[3].env.PROTON_PASS_SESSION_DIR)
    expect(calls[0].env.PROTON_PASS_KEY_PROVIDER).toBe('env')
    expect(calls[0].env.PROTON_PASS_ENCRYPTION_KEY).toBeTruthy()
    expect(calls[1].env.PROTON_PASS_AGENT_REASON).toBe('Retrieve password for a user-requested browser login.')
    expect(calls[4].env.PROTON_PASS_AGENT_REASON).toBe('Retrieve username for a user-requested browser login.')
    expect(calls[0].env.PROTON_PASS_DISABLE_TELEMETRY).toBe('1')
    expect(calls[0].env.PROTON_PASS_NO_UPDATE_CHECK).toBe('1')
    expect(JSON.stringify(calls.map(call => call.args))).not.toContain('private-token')
    expect(removed).toEqual(['/isolated/session-1', '/isolated/session-2'])
  })

  it('lists both item and vault shares and projects only approved metadata', async () => {
    const { provider, calls } = setup()
    const items = await provider.list()
    expect(items).toEqual([
      { shareId: 'share-1', itemId: 'item-1', title: 'Shop', share: 'Automation' },
      { shareId: 'share-2', itemId: 'item-1', title: 'Shop', share: 'Single item' },
    ])
    expect(calls.at(-1)?.args).toEqual(['logout'])
    expect(JSON.stringify(items)).not.toContain('password')
    expect(JSON.stringify(items)).not.toContain('private')
  })

  it('cleans up even when login or retrieval fails and never exposes CLI errors', async () => {
    for (const failingCommand of ['login', 'item']) {
      const { runtime, calls, removed } = setup()
      const original = runtime.run
      runtime.run = async command => {
        if (command.args[0] === failingCommand) {
          calls.push(command)
          throw new Error('stderr contains private-token and password')
        }
        return original(command)
      }
      const provider = createProtonPass(runtime)
      await expect(provider.read({ shareId: 's', itemId: 'i', title: 'Shop', share: 'Vault' }, 'password')).rejects.toThrow('Proton Pass operation failed')
      expect(calls.at(-1)?.args).toEqual(['logout'])
      expect(removed).toEqual(['/isolated/session-1'])
    }
  })

  it('does not fall back to another service session when no token is configured', async () => {
    const { runtime, calls } = setup()
    runtime.readToken = async () => null
    await expect(createProtonPass(runtime).list()).rejects.toThrow('not configured')
    expect(calls).toEqual([])
  })

  it('rejects unexpected JSON without echoing its contents and still logs out', async () => {
    const { runtime, calls, removed } = setup()
    const original = runtime.run
    runtime.run = command => (command.args[0] === 'share' ? Promise.resolve('secret invalid JSON') : original(command))
    await expect(createProtonPass(runtime).list()).rejects.toThrow('Proton Pass operation failed')
    expect(calls.at(-1)?.args).toEqual(['logout'])
    expect(removed).toHaveLength(1)
  })

  it('cleans up a failed logout without exposing its error', async () => {
    const { runtime, removed } = setup()
    const original = runtime.run
    runtime.run = command => (command.args[0] === 'logout' ? Promise.reject(new Error('private-token')) : original(command))
    await expect(createProtonPass(runtime).list()).resolves.toHaveLength(2)
    expect(removed).toHaveLength(1)
  })
})
