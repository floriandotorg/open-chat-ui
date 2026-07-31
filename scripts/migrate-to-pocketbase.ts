import { Database } from 'bun:sqlite'
import PocketBase, { ClientResponseError } from 'pocketbase'

const args = process.argv.slice(2)
let password = ''
let dbPath = process.env.OLD_DATABASE_URL ?? 'local.db'
for (let n = 0; n < args.length; ++n) {
  if (args[n] === '--password' && args[n + 1]) {
    password = args[++n]
  } else if (args[n] === '--db' && args[n + 1]) {
    dbPath = args[++n]
  }
}

if (!password) {
  console.error('Usage: bun scripts/migrate-to-pocketbase.ts --password <pw> [--db local.db]')
  process.exit(1)
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters (PocketBase minimum). better-auth hashes cannot be imported, so every migrated user is assigned this password.')
  process.exit(1)
}

if (dbPath.startsWith('file:')) dbPath = dbPath.slice(5)

const url = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const email = process.env.POCKETBASE_ADMIN_EMAIL
const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD
if (!email || !adminPassword) {
  console.error('POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD are required')
  process.exit(1)
}

const pb = new PocketBase(url)
await pb.collection('_superusers').authWithPassword(email, adminPassword)

const sqlite = new Database(dbPath, { readonly: true })

const iso = (seconds: number | null): string | null => {
  if (seconds === null || seconds === undefined) return null
  return new Date(seconds * 1000).toISOString().replace('T', ' ')
}

const parseJson = (text: string | null): unknown | null => {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const bool = (v: number | null): boolean => Boolean(v)

const safeCreate = async (collection: string, body: Record<string, unknown>): Promise<boolean> => {
  try {
    await pb.collection(collection).create(body)
    return true
  } catch (err) {
    if (err instanceof ClientResponseError) {
      const idErr = err.response?.data?.id
      if (idErr?.code === 'validation_pk_invalid') return false
      console.warn(`skip ${collection} ${body.id}: ${err.message}`)
      return false
    }
    throw err
  }
}

const counts = new Map<string, number>()
const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1)

const migrateUsers = async () => {
  const rows = sqlite.query('SELECT id, name, email, email_verified FROM user').all() as { id: string; name: string; email: string; email_verified: number }[]
  for (const r of rows) {
    const ok = await safeCreate('users', {
      id: r.id,
      email: r.email,
      name: r.name,
      verified: bool(r.email_verified),
      emailVisibility: true,
      password,
      passwordConfirm: password,
    })
    if (ok) bump('users')
  }
}

const migrateSystemPrompts = async () => {
  const rows = sqlite.query('SELECT id, user_id, title, content, is_default, created_at, updated_at FROM system_prompts').all() as { id: string; user_id: string; title: string; content: string; is_default: number; created_at: number; updated_at: number }[]
  for (const r of rows) {
    const ok = await safeCreate('system_prompts', {
      id: r.id,
      user: r.user_id,
      title: r.title,
      content: r.content,
      isDefault: bool(r.is_default),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })
    if (ok) bump('system_prompts')
  }
}

const migrateUserSettings = async () => {
  const rows = sqlite.query('SELECT id, user_id, default_system_prompt, default_provider, default_model, title_model, dictation_provider, updated_at FROM user_settings').all() as {
    id: string
    user_id: string
    default_system_prompt: string | null
    default_provider: string | null
    default_model: string | null
    title_model: string | null
    dictation_provider: string | null
    updated_at: number
  }[]
  for (const r of rows) {
    const ok = await safeCreate('user_settings', {
      id: r.id,
      user: r.user_id,
      defaultSystemPrompt: r.default_system_prompt,
      defaultProvider: r.default_provider,
      defaultModel: r.default_model,
      titleModel: r.title_model,
      dictationProvider: r.dictation_provider,
      updatedAt: iso(r.updated_at),
    })
    if (ok) bump('user_settings')
  }
}

const migrateApiKeys = async () => {
  const rows = sqlite.query('SELECT id, user_id, provider, encrypted_key, iv, created_at, updated_at FROM api_keys').all() as { id: string; user_id: string; provider: string; encrypted_key: string; iv: string; created_at: number; updated_at: number }[]
  for (const r of rows) {
    const ok = await safeCreate('api_keys', {
      id: r.id,
      user: r.user_id,
      provider: r.provider,
      encryptedKey: r.encrypted_key,
      iv: r.iv,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })
    if (ok) bump('api_keys')
  }
}

const migrateProviderModels = async () => {
  const rows = sqlite.query('SELECT id, provider, model_id, enabled, created_at, updated_at FROM provider_models').all() as { id: string; provider: string; model_id: string; enabled: number; created_at: number; updated_at: number }[]
  for (const r of rows) {
    const ok = await safeCreate('provider_models', {
      id: r.id,
      provider: r.provider,
      modelId: r.model_id,
      enabled: bool(r.enabled),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })
    if (ok) bump('provider_models')
  }
}

const migrateConversations = async () => {
  const validPromptIds = new Set((sqlite.query('SELECT id FROM system_prompts').all() as { id: string }[]).map(r => r.id))
  const rows = sqlite.query('SELECT id, user_id, title, system_prompt, system_prompt_id, default_provider, default_model, container, active_branches, generating, favorite, created_at, updated_at FROM conversations').all() as {
    id: string
    user_id: string
    title: string
    system_prompt: string | null
    system_prompt_id: string | null
    default_provider: string | null
    default_model: string | null
    container: string | null
    active_branches: string | null
    generating: number | null
    favorite: number | null
    created_at: number
    updated_at: number
  }[]
  for (const r of rows) {
    const systemPromptRef = r.system_prompt_id && validPromptIds.has(r.system_prompt_id) ? r.system_prompt_id : null
    const ok = await safeCreate('conversations', {
      id: r.id,
      user: r.user_id,
      title: r.title,
      systemPrompt: r.system_prompt,
      systemPromptRef,
      defaultProvider: r.default_provider,
      defaultModel: r.default_model,
      container: r.container,
      activeBranches: parseJson(r.active_branches),
      generating: bool(r.generating),
      favorite: bool(r.favorite),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })
    if (ok) bump('conversations')
  }
}

const migrateMessages = async () => {
  const validConversationIds = new Set((sqlite.query('SELECT id FROM conversations').all() as { id: string }[]).map(r => r.id))
  const rows = sqlite.query('SELECT id, conversation_id, parent_id, role, content, images, files, provider, model, input_tokens, output_tokens, tool_calls, raw_content_blocks, created_at FROM messages').all() as {
    id: string
    conversation_id: string
    parent_id: string | null
    role: string
    content: string
    images: string | null
    files: string | null
    provider: string | null
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    tool_calls: string | null
    raw_content_blocks: string | null
    created_at: number
  }[]
  let orphans = 0
  for (const r of rows) {
    if (!validConversationIds.has(r.conversation_id)) {
      ++orphans
      continue
    }
    const ok = await safeCreate('messages', {
      id: r.id,
      conversation: r.conversation_id,
      parentId: r.parent_id,
      role: r.role,
      content: r.content,
      images: parseJson(r.images),
      files: parseJson(r.files),
      provider: r.provider,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      toolCalls: parseJson(r.tool_calls),
      rawContentBlocks: parseJson(r.raw_content_blocks),
      createdAt: iso(r.created_at),
    })
    if (ok) bump('messages')
  }
  if (orphans > 0) counts.set('messages_orphans_skipped', orphans)
}

console.log(`Migrating from ${dbPath} to ${url}`)
await migrateUsers()
await migrateSystemPrompts()
await migrateUserSettings()
await migrateApiKeys()
await migrateProviderModels()
await migrateConversations()
await migrateMessages()

for (const [name, count] of counts) {
  console.log(`${name}: ${count}`)
}
sqlite.close()
console.log('migration done')
