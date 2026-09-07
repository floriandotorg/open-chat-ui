import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync } from 'node:zlib'

const LIMIT_BYTES = 150 * 1024
const nodesDir = 'build/client/_app/immutable/nodes'

const files = readdirSync(nodesDir).filter(file => file.endsWith('.js'))
if (files.length === 0) {
  console.error(`no js files found in ${nodesDir} (run bun run build first)`)
  process.exit(1)
}

const sizes = files.map(file => ({ file, bytes: brotliCompressSync(readFileSync(join(nodesDir, file))).length })).sort((a, b) => b.bytes - a.bytes)

for (const { file, bytes } of sizes) {
  const over = bytes > LIMIT_BYTES ? '  <-- over limit' : ''
  console.log(`${(bytes / 1024).toFixed(1).padStart(7)} KB brotli  ${file}${over}`)
}

const worst = sizes[0]
if (worst.bytes > LIMIT_BYTES) {
  console.error(`\n${worst.file} exceeds ${(LIMIT_BYTES / 1024).toFixed(0)} KB brotli (${(worst.bytes / 1024).toFixed(1)} KB)`)
  process.exit(1)
}
console.log(`\nlargest: ${worst.file} at ${(worst.bytes / 1024).toFixed(1)} KB brotli (limit ${(LIMIT_BYTES / 1024).toFixed(0)} KB)`)
