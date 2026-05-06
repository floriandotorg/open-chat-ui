import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}
const path = url.startsWith('file:') ? url.slice(5) : url
const db = new Database(path)

db.exec(`CREATE TABLE IF NOT EXISTS __open_chat_migrations (
  tag TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
)`)

const dir = 'drizzle'
const files = readdirSync(dir)
  .filter(f => f.endsWith('.sql'))
  .sort()

const applied = new Set((db.query('SELECT tag FROM __open_chat_migrations').all() as { tag: string }[]).map(r => r.tag))

const ignorable = (msg: string) => /duplicate column name|already exists/i.test(msg)

for (const file of files) {
  const tag = file.replace(/\.sql$/, '')
  if (applied.has(tag)) {
    continue
  }
  const sql = readFileSync(join(dir, file), 'utf-8')
  const statements = sql
    .split(/-->\s*statement-breakpoint/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !/^--/.test(s))

  db.exec('BEGIN')
  try {
    for (const stmt of statements) {
      try {
        db.exec(stmt)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (ignorable(message)) {
          console.log(`[migrate] ${tag}: skipping already-applied statement (${message})`)
          continue
        }
        throw err
      }
    }
    db.run('INSERT INTO __open_chat_migrations (tag, applied_at) VALUES (?, ?)', [tag, Date.now()])
    db.exec('COMMIT')
    console.log(`[migrate] applied ${tag}`)
  } catch (err) {
    db.exec('ROLLBACK')
    console.error(`[migrate] failed on ${tag}`)
    throw err
  }
}

db.close()
