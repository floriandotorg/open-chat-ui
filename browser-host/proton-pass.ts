import { randomBytes } from 'node:crypto'
import type { BrowserCredentialField } from '#lib/browser-protocol.ts'

export interface ProtonItem {
  shareId: string
  itemId: string
  title: string
  share: string
}

export interface ProtonCommand {
  args: string[]
  env: Record<string, string>
}

export interface ProtonRuntime {
  readToken: () => Promise<string | null>
  createDirectory: () => Promise<string>
  removeDirectory: (path: string) => Promise<void>
  run: (command: ProtonCommand) => Promise<string>
}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Unexpected Proton response')
  }
  return Object.fromEntries(Object.entries(value))
}

const entries = (raw: string, key: string): Record<string, unknown>[] => {
  const parsed: unknown = JSON.parse(raw)
  const list = record(parsed)[key]
  if (!Array.isArray(list)) {
    throw new Error('Unexpected Proton response')
  }
  return list.map(record)
}

const string = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Unexpected Proton response')
  }
  return value
}

export const createProtonPass = (runtime: ProtonRuntime) => {
  const withLogin = async <T>(reason: string, operation: (run: (args: string[]) => Promise<string>) => Promise<T>): Promise<T> => {
    let directory: string | undefined
    let env: Record<string, string> | undefined
    try {
      const token = await runtime.readToken()
      if (!token) {
        throw new Error('not configured')
      }
      directory = await runtime.createDirectory()
      env = {
        PROTON_PASS_SESSION_DIR: directory,
        PROTON_PASS_KEY_PROVIDER: 'env',
        PROTON_PASS_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        PROTON_PASS_AGENT_REASON: reason,
        PROTON_PASS_DISABLE_TELEMETRY: '1',
        PROTON_PASS_NO_UPDATE_CHECK: '1',
        PASS_LOG_LEVEL: 'off',
      }
      await runtime.run({ args: ['login'], env: { ...env, PROTON_PASS_PERSONAL_ACCESS_TOKEN: token } })
      const sessionEnv = env
      return await operation(args => runtime.run({ args, env: sessionEnv }))
    } catch (error) {
      if (!directory && error instanceof Error && error.message === 'not configured') {
        throw new Error('Proton Pass is not configured on the browser host. Ask the user to run browser-host/proton-setup.sh on their Mac.')
      }
      throw new Error('Proton Pass operation failed. Check the CLI installation, token permissions and expiration on the browser host.')
    } finally {
      if (directory && env) {
        await runtime.run({ args: ['logout'], env }).catch(() => {})
      }
      if (directory) {
        await runtime.removeDirectory(directory).catch(() => {})
      }
    }
  }

  const list = () =>
    withLogin('List available logins for a user-requested browser task.', async run => {
      const shares = entries(await run(['share', 'list', '--output', 'json']), 'shares')
      const items: ProtonItem[] = []
      for (const share of shares) {
        const shareId = string(share.id)
        const shareName = string(share.name)
        const rows = entries(await run(['item', 'list', '--share-id', shareId, '--filter-type', 'login', '--filter-state', 'active', '--output', 'json']), 'items')
        for (const row of rows) {
          const content = typeof row.content === 'object' && row.content !== null ? record(row.content) : undefined
          items.push({ shareId, itemId: string(row.id), title: string(row.title ?? content?.title), share: shareName })
        }
      }
      return items
    })

  const read = (item: ProtonItem, field: BrowserCredentialField) =>
    withLogin(`Retrieve ${field} for a user-requested browser login.`, async run => {
      const raw = await run(['item', 'view', '--share-id', item.shareId, '--item-id', item.itemId, '--field', field])
      return raw.endsWith('\n') ? raw.slice(0, -1) : raw
    })

  return { list, read }
}

export type ProtonPass = ReturnType<typeof createProtonPass>
