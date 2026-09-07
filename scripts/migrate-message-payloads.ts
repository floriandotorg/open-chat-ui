import { type LiveEntry, slimEntry } from '../src/lib/server/history'
import type { MessagePayload } from '../src/lib/types'
import PocketBase from 'pocketbase'

const url = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const email = process.env.POCKETBASE_ADMIN_EMAIL
const password = process.env.POCKETBASE_ADMIN_PASSWORD

if (!email || !password) {
  console.error('POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD are required')
  process.exit(1)
}

const pb = new PocketBase(url)
pb.autoCancellation(false)
await pb.collection('_superusers').authWithPassword(email, password)

const now = () => new Date().toISOString()

const payloadRows = await pb.collection('message_payloads').getFullList({ fields: 'message' })
const hasPayload = new Set(payloadRows.map(r => r.message))

let migrated = 0
let skipped = 0
let page = 1

for (;;) {
  const result = await pb.collection('messages').getList(page, 200, { filter: 'generating = false', sort: 'createdAt' })
  if (result.items.length === 0) break
  for (const row of result.items) {
    const entries = (Array.isArray(row.toolCalls) ? row.toolCalls : []) as LiveEntry[]
    const rawContentBlocks = Array.isArray(row.rawContentBlocks) && row.rawContentBlocks.length ? row.rawContentBlocks : null
    const thinking = typeof row.thinking === 'string' && row.thinking ? row.thinking : null
    const hasInlineResults = entries.some(e => ('type' in e ? e.stdout !== undefined || e.stderr !== undefined : e.result !== undefined || e.rawResult !== undefined))
    const hasInlineInputs = entries.some(e => ('type' in e ? e.input !== undefined && Object.keys(e.input).length > 0 : e.arguments !== undefined && Object.keys(e.arguments).length > 0))
    if (!hasInlineResults && !hasInlineInputs && !rawContentBlocks && !thinking) {
      ++skipped
      continue
    }
    const toolResults: MessagePayload['toolResults'] = {}
    for (const entry of entries) {
      if ('type' in entry) {
        toolResults[entry.id] = {
          ...(entry.input !== undefined ? { input: entry.input } : {}),
          ...(entry.stdout !== undefined ? { stdout: entry.stdout } : {}),
          ...(entry.stderr !== undefined ? { stderr: entry.stderr } : {}),
        }
      } else {
        toolResults[entry.id] = {
          ...(entry.arguments !== undefined ? { arguments: entry.arguments } : {}),
          ...(entry.result !== undefined ? { result: entry.result } : {}),
          ...(entry.rawResult !== undefined ? { rawResult: entry.rawResult } : {}),
        }
      }
    }
    const slimToolCalls = entries.length ? entries.map(e => slimEntry(e, true)) : null
    const messageFields = { toolCalls: slimToolCalls, rawContentBlocks: null, thinking: null, eventSeq: 0 }
    if (hasPayload.has(row.id)) {
      const existing = await pb.collection('message_payloads').getFirstListItem(pb.filter('message = {:m}', { m: row.id }))
      const merged = { ...existing.toolResults }
      for (const [id, results] of Object.entries(toolResults)) {
        merged[id] = { ...results, ...merged[id] }
      }
      await pb.collection('message_payloads').update(existing.id, { toolResults: merged, ...(rawContentBlocks ? { rawContentBlocks } : {}), ...(thinking ? { thinking } : {}) })
      await pb.collection('messages').update(row.id, messageFields)
    } else {
      await pb.collection('message_payloads').create({ message: row.id, toolResults, rawContentBlocks, thinking, createdAt: now() })
      await pb.collection('messages').update(row.id, messageFields)
    }
    ++migrated
    if (migrated % 100 === 0) console.log(`migrated ${migrated}…`)
  }
  if (result.items.length < 200) break
  ++page
}

console.log(`done: ${migrated} migrated, ${skipped} skipped`)
