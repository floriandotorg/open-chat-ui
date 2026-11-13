import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { BROWSER_HOST_DEFAULT_PORT } from '#lib/browser-protocol.ts'
import { hashToken, isTokenHash } from './auth'

export interface BrowserHostConfig {
  tokenHash: string
  port: number
}

export const dataDir = process.env.BROWSER_HOST_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'open-chat-ui-browser')
const parseConfig = (value: unknown): { config: BrowserHostConfig; migrate: boolean } | null => {
  if (typeof value !== 'object' || value === null || !('port' in value)) {
    return null
  }
  const { port } = value
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  if ('tokenHash' in value) {
    return isTokenHash(value.tokenHash) ? { config: { tokenHash: value.tokenHash, port }, migrate: 'token' in value } : null
  }
  if ('token' in value && typeof value.token === 'string' && value.token.length >= 16) {
    return { config: { tokenHash: hashToken(value.token), port }, migrate: true }
  }
  return null
}

const saveConfig = async (directory: string, config: BrowserHostConfig): Promise<void> => {
  await mkdir(directory, { recursive: true })
  const temporaryPath = join(directory, `config.${randomUUID()}.tmp`)
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(temporaryPath, join(directory, 'config.json'))
}

const readConfig = async (directory: string): Promise<BrowserHostConfig | null> => {
  const configPath = join(directory, 'config.json')
  let contents: string
  try {
    contents = await readFile(configPath, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    throw new Error(`Invalid browser host configuration: ${configPath}`)
  }
  const parsed = parseConfig(value)
  if (!parsed) {
    throw new Error(`Invalid browser host configuration: ${configPath}`)
  }
  if (parsed.migrate) {
    await saveConfig(directory, parsed.config)
  }
  return parsed.config
}

export const loadConfig = async (directory = dataDir): Promise<BrowserHostConfig> => {
  const config = await readConfig(directory)
  if (!config) {
    throw new Error(`Missing ${join(directory, 'config.json')}. Run bun run browser-host:install first.`)
  }
  return config
}

const createToken = async (directory: string, port: number): Promise<{ config: BrowserHostConfig; token: string }> => {
  const token = randomBytes(32).toString('base64url')
  const config = { tokenHash: hashToken(token), port }
  await saveConfig(directory, config)
  return { config, token }
}

export const ensureConfig = async (directory = dataDir): Promise<{ config: BrowserHostConfig; token?: string }> => {
  const config = await readConfig(directory)
  return config ? { config } : createToken(directory, BROWSER_HOST_DEFAULT_PORT)
}

export const rotateToken = async (directory = dataDir): Promise<{ config: BrowserHostConfig; token: string }> => {
  const config = await loadConfig(directory)
  return createToken(directory, config.port)
}

const isTailscaleAddress = (address: string): boolean => {
  const [a, b] = address.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

export const findBindAddress = (): string | null => {
  if (process.env.BROWSER_HOST_BIND) {
    return process.env.BROWSER_HOST_BIND
  }
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && isTailscaleAddress(entry.address)) {
        return entry.address
      }
    }
  }
  return null
}
