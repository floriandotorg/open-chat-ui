import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { BROWSER_HOST_DEFAULT_PORT } from '#lib/browser-protocol.ts'

export interface BrowserHostConfig {
  token: string
  port: number
}

export const dataDir = process.env.BROWSER_HOST_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'open-chat-ui-browser')
const configPath = join(dataDir, 'config.json')

const parseConfig = (value: unknown): BrowserHostConfig | null => {
  if (typeof value !== 'object' || value === null || !('token' in value) || !('port' in value)) {
    return null
  }
  const { token, port } = value
  if (typeof token !== 'string' || token.length < 16 || typeof port !== 'number' || !Number.isInteger(port)) {
    return null
  }
  return { token, port }
}

export const loadConfig = async (): Promise<BrowserHostConfig> => {
  const file = Bun.file(configPath)
  const config = (await file.exists()) ? parseConfig(await file.json()) : null
  if (!config) {
    throw new Error(`Missing or invalid ${configPath}. Run bun run browser-host:install first.`)
  }
  return config
}

export const ensureConfig = async (): Promise<BrowserHostConfig> => {
  const file = Bun.file(configPath)
  const existing = (await file.exists()) ? parseConfig(await file.json().catch(() => null)) : null
  if (existing) {
    return existing
  }
  const config = { token: randomBytes(32).toString('base64url'), port: BROWSER_HOST_DEFAULT_PORT }
  await mkdir(dataDir, { recursive: true })
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  return config
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
