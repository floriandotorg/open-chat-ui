import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserStagedFile } from '#lib/browser-protocol.ts'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_NAME_LENGTH = 200

export const isValidFileId = (id: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(id)

export const sanitizeFileName = (raw: string | null | undefined): string => {
  const base = (raw ?? '').split(/[/\\]/).pop() ?? ''
  const cleaned = base
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/^\.+/, '')
    .trim()
  if (!cleaned) {
    return 'file'
  }
  if (cleaned.length <= MAX_NAME_LENGTH) {
    return cleaned
  }
  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, MAX_NAME_LENGTH - extension.length) + extension
}

export const createUploadStore = (rootDir: string) => {
  const sessionDir = (sessionId: string) => join(rootDir, sessionId)
  const staged = new Map<string, Map<string, { path: string; name: string }>>()

  const stage = async (sessionId: string, fileId: string, rawName: string | null, data: ArrayBuffer): Promise<BrowserStagedFile> => {
    const name = sanitizeFileName(rawName)
    const dir = join(sessionDir(sessionId), fileId)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const path = join(dir, name)
    await Bun.write(path, data)
    const files = staged.get(sessionId) ?? new Map()
    files.set(fileId, { path, name })
    staged.set(sessionId, files)
    return { id: fileId, name, size: (await stat(path)).size }
  }

  const resolve = (sessionId: string, fileIds: string[]): { paths: string[]; names: string[] } | { missing: string[] } => {
    const files = staged.get(sessionId)
    const missing = fileIds.filter(id => !files?.has(id))
    if (missing.length || !files) {
      return { missing }
    }
    const entries = fileIds.flatMap(id => {
      const entry = files.get(id)
      return entry ? [entry] : []
    })
    return { paths: entries.map(entry => entry.path), names: entries.map(entry => entry.name) }
  }

  const release = async (sessionId: string) => {
    staged.delete(sessionId)
    await rm(sessionDir(sessionId), { recursive: true, force: true })
  }

  const clearAll = async () => {
    staged.clear()
    await rm(rootDir, { recursive: true, force: true })
  }

  return { stage, resolve, release, clearAll }
}

export type UploadStore = ReturnType<typeof createUploadStore>
