import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '$env/dynamic/private'

const getUploadDir = () => {
  const dir = env.UPLOAD_DIR ?? './uploads'
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export const getUploadPath = (filename: string) => join(getUploadDir(), filename)

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'text/csv': 'csv',
}

const MIME_MAP: Record<string, string> = Object.fromEntries(Object.entries(EXT_MAP).map(([mime, ext]) => [ext, mime]))

export const ALLOWED_MIME_TYPES = new Set(Object.keys(EXT_MAP))

export const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'])

export const FILE_MIME_TYPES = new Set(['text/csv'])

export const extForMime = (mimeType: string): string | undefined => EXT_MAP[mimeType]

export const mimeForExt = (ext: string): string | undefined => MIME_MAP[ext]
