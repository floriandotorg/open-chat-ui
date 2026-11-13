import type { BrowserAction } from '#lib/browser-protocol.ts'
import type { TaskSession } from './task-session'
import { z } from 'zod'

const listInput = z.object({ query: z.string().default('') })
const fillInput = z.object({
  credentialId: z.string().min(1),
  field: z.enum(['username', 'email', 'password', 'totp']),
  target: z.union([z.object({ ref: z.string().min(1) }), z.object({ x: z.number().finite(), y: z.number().finite() })]),
})

export const CREDENTIAL_TOOLS = [
  {
    name: 'credential_list',
    description: "List login names available through Proton Pass on the user's Mac. Returns session-local credential IDs, titles and share names, never credential values. Filter by title/share with query, or use an empty query to list all. If unavailable, ask the user to log in.",
    parameters: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Case-insensitive title/share search; empty string lists all.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'credential_fill',
    description:
      'Fill one input with a Proton Pass username, email, password or current TOTP code without receiving its value. First list credentials. Target an input with a browser ref or viewport x/y coordinates. Check you are on the intended login site. Does not submit the form. Never reveal or read back filled credentials.',
    parameters: {
      type: 'object' as const,
      properties: {
        credentialId: { type: 'string' },
        field: { type: 'string', enum: ['username', 'email', 'password', 'totp'] },
        target: {
          anyOf: [
            { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false },
            { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false },
          ],
        },
      },
      required: ['credentialId', 'field', 'target'],
      additionalProperties: false,
    },
  },
]

export const runCredentialTool = async (session: TaskSession, name: string, input: unknown): Promise<string | null> => {
  let action: BrowserAction
  if (name === 'credential_list') {
    const parsed = listInput.safeParse(input)
    if (!parsed.success) {
      return 'Invalid credential tool arguments.'
    }
    action = { type: 'credential_list', ...parsed.data }
  } else if (name === 'credential_fill') {
    const parsed = fillInput.safeParse(input)
    if (!parsed.success) {
      return 'Invalid credential tool arguments.'
    }
    action = { type: 'credential_fill', ...parsed.data }
  } else {
    return null
  }
  const [result] = await session.act([action])
  return result?.ok ? (result.text ?? 'Done.') : `Credential operation failed: ${result?.error ?? 'no result'}`
}
