import { requireUser } from '$lib/server/auth-guard'
import { getUploadPath, mimeForExt } from '$lib/server/uploads'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { existsSync } from 'node:fs'

export const GET: RequestHandler = async ({ params, locals }) => {
  requireUser(locals.user)

  const filename = params.id
  const ext = filename.split('.').pop() ?? ''
  const mimeType = mimeForExt(ext)

  if (!mimeType) {
    throw error(400, 'Invalid file type')
  }

  const filePath = getUploadPath(filename)
  if (!existsSync(filePath)) {
    throw error(404, 'File not found')
  }

  const file = Bun.file(filePath)
  return new Response(file.stream(), {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
