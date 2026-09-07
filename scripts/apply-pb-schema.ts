import { readFileSync } from 'node:fs'
import PocketBase from 'pocketbase'

const url = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const email = process.env.POCKETBASE_ADMIN_EMAIL
const password = process.env.POCKETBASE_ADMIN_PASSWORD

if (!email || !password) {
  console.error('POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD are required')
  process.exit(1)
}

type Field = {
  name: string
  type: string
  collectionId?: string
  [key: string]: unknown
}

type SchemaCollection = {
  name: string
  type: string
  fields: Field[]
  indexes?: string[]
  listRule?: string | null
  viewRule?: string | null
  createRule?: string | null
  updateRule?: string | null
  deleteRule?: string | null
}

const schema: SchemaCollection[] = JSON.parse(readFileSync('pocketbase/pb_schema.json', 'utf8'))

const ID_FIELD: Field = {
  name: 'id',
  type: 'text',
  system: true,
  primaryKey: true,
  required: true,
  presentable: false,
  hidden: false,
  help: '',
  autogeneratePattern: '[a-z0-9]{15}',
  min: 15,
  max: 36,
  pattern: '^[a-zA-Z0-9-]+$',
}

const pb = new PocketBase(url)
await pb.collection('_superusers').authWithPassword(email, password)

const existing = await pb.collections.getFullList<{ id: string; name: string; fields: Field[] }>({ fields: 'id,name,fields,type' })
const nameToId = new Map<string, string>(existing.map(c => [c.name, c.id]))

const usersDef = schema.find(c => c.name === 'users' && c.type === 'auth')
if (!usersDef) throw new Error('users auth collection missing from schema')

let usersId = nameToId.get('users')
if (!usersId) {
  const created = await pb.collections.create<{ id: string; name: string }>({
    name: 'users',
    type: 'auth',
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [ID_FIELD, ...usersDef.fields],
  })
  usersId = created.id
  nameToId.set('users', usersId)
  console.log('created users (auth)')
} else {
  const current = await pb.collections.getOne<{ fields: Field[] }>(usersId)
  const existingNames = new Set(current.fields.map(f => f.name))
  const merged = current.fields.map(f => (f.name === 'id' ? ID_FIELD : f))
  for (const f of usersDef.fields) {
    if (!existingNames.has(f.name)) merged.push(f)
  }
  await pb.collections.update(usersId, { fields: merged })
  console.log('ensured users.name field')
}

const resolveRelations = (fields: Field[]): Field[] =>
  fields.map(f => {
    if (f.type !== 'relation' || !f.collectionId) return f
    const resolved = nameToId.get(f.collectionId)
    if (!resolved) throw new Error(`Relation target not found: ${f.collectionId} (for field ${f.name})`)
    return { ...f, collectionId: resolved }
  })

const baseDefs = schema.filter(c => c.type === 'base')
const order = ['api_keys', 'system_prompts', 'user_settings', 'provider_models', 'conversations', 'messages', 'stream_events', 'message_payloads', 'heartbeat']
const ordered = [...baseDefs].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))

for (const def of ordered) {
  const fields = resolveRelations(def.fields)
  const body = {
    name: def.name,
    type: def.type,
    system: false,
    listRule: def.listRule ?? null,
    viewRule: def.viewRule ?? null,
    createRule: def.createRule ?? null,
    updateRule: def.updateRule ?? null,
    deleteRule: def.deleteRule ?? null,
    fields,
    indexes: def.indexes ?? [],
  }
  const existingId = nameToId.get(def.name)
  if (existingId) {
    await pb.collections.update(existingId, body)
    console.log(`updated ${def.name}`)
  } else {
    const created = await pb.collections.create<{ id: string; name: string }>(body)
    nameToId.set(def.name, created.id)
    console.log(`created ${def.name}`)
  }
}

// The batch API lets finalize delete a message's stream events in one request.
await pb.settings.update({ batch: { enabled: true, maxRequests: 200, timeout: 10 } })
console.log('batch api enabled')

console.log('schema applied')
