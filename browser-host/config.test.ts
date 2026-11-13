import { join } from 'node:path'
import { hashToken, isAuthorized } from './auth'
import { ensureConfig, loadConfig, rotateToken } from './config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async (path: string) => {
    const contents = disk.files.get(path)
    if (contents === undefined) {
      throw Object.assign(new Error('Missing file'), { code: 'ENOENT' })
    }
    return contents
  }),
  writeFile: vi.fn(async (path: string, contents: string) => {
    disk.files.set(path, contents)
  }),
  rename: vi.fn(async (source: string, target: string) => {
    const contents = disk.files.get(source)
    if (contents === undefined) {
      throw new Error('Missing temporary file')
    }
    disk.files.set(target, contents)
    disk.files.delete(source)
  }),
}))

import { readFile, rename, writeFile } from 'node:fs/promises'

const directory = '/virtual/browser-host'
const path = join(directory, 'config.json')
const legacyToken = 'existing-browser-host-token'
const bearer = (token: string) => new Request('http://localhost/health', { headers: { authorization: `Bearer ${token}` } })

beforeEach(() => {
  disk.files.clear()
  vi.clearAllMocks()
})

describe('browser host configuration', () => {
  it('persists only a hash and returns a new token once', async () => {
    const created = await ensureConfig(directory)
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    if (!created.token) {
      throw new Error('Expected a new token')
    }
    expect(created.config).toEqual({ tokenHash: hashToken(created.token), port: 9330 })
    expect(JSON.parse(disk.files.get(path) ?? '')).toEqual(created.config)
    expect(disk.files.get(path)).not.toContain(created.token)
    expect(writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), { mode: 0o600, flag: 'wx' })
    expect(rename).toHaveBeenCalledWith(expect.any(String), path)
    expect(await ensureConfig(directory)).toEqual({ config: created.config })
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('migrates plaintext tokens on load without invalidating existing clients', async () => {
    disk.files.set(path, JSON.stringify({ token: legacyToken, port: 9440 }))
    const config = await loadConfig(directory)
    expect(config).toEqual({ tokenHash: hashToken(legacyToken), port: 9440 })
    expect(isAuthorized(bearer(legacyToken), config.tokenHash)).toBe(true)
    expect(JSON.parse(disk.files.get(path) ?? '')).toEqual(config)
    expect(disk.files.get(path)).not.toContain(legacyToken)
    expect(await ensureConfig(directory)).toEqual({ config })
  })

  it('removes a leftover plaintext field from an otherwise hashed config', async () => {
    const config = { tokenHash: hashToken(legacyToken), port: 9330 }
    disk.files.set(path, JSON.stringify({ ...config, token: legacyToken }))
    expect(await loadConfig(directory)).toEqual(config)
    expect(JSON.parse(disk.files.get(path) ?? '')).toEqual(config)
  })

  it('loads hashed configs without rewriting them', async () => {
    const config = { tokenHash: hashToken(legacyToken), port: 9330 }
    disk.files.set(path, JSON.stringify(config))
    expect(await loadConfig(directory)).toEqual(config)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('rotates tokens while preserving the port and invalidating the old token', async () => {
    disk.files.set(path, JSON.stringify({ tokenHash: hashToken(legacyToken), port: 9440 }))
    const rotated = await rotateToken(directory)
    expect(rotated.config.port).toBe(9440)
    expect(isAuthorized(bearer(rotated.token), rotated.config.tokenHash)).toBe(true)
    expect(isAuthorized(bearer(legacyToken), rotated.config.tokenHash)).toBe(false)
    expect(JSON.parse(disk.files.get(path) ?? '')).toEqual(rotated.config)
    expect(disk.files.get(path)).not.toContain(rotated.token)
  })

  it('requires setup for a missing config', async () => {
    await expect(loadConfig(directory)).rejects.toThrow('browser-host:install')
    await expect(rotateToken(directory)).rejects.toThrow('browser-host:install')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('never silently replaces invalid existing configurations', async () => {
    for (const contents of ['invalid json', '{}', JSON.stringify({ token: 'short', port: 9330 }), JSON.stringify({ tokenHash: 'z'.repeat(64), token: legacyToken, port: 9330 }), ...[0, 65536, 1.5, '9330'].map(port => JSON.stringify({ token: legacyToken, port }))]) {
      disk.files.set(path, contents)
      await expect(ensureConfig(directory)).rejects.toThrow('Invalid browser host configuration')
      expect(disk.files.get(path)).toBe(contents)
    }
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('propagates read and migration write failures instead of replacing or accepting plaintext', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))
    await expect(ensureConfig(directory)).rejects.toThrow('Permission denied')
    disk.files.set(path, JSON.stringify({ token: legacyToken, port: 9330 }))
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('Disk full'))
    await expect(loadConfig(directory)).rejects.toThrow('Disk full')
    expect(rename).not.toHaveBeenCalled()
  })
})
