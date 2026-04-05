import { requireUser } from '$lib/server/auth-guard'
import { ALLOWED_MIME_TYPES, extForMime, getUploadPath } from '$lib/server/uploads'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  requireUser(locals.user)

  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    throw error(400, 'No file provided')
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw error(400, `Unsupported file type: ${file.type}`)
  }

  const maxSize = 20 * 1024 * 1024
  if (file.size > maxSize) {
    throw error(400, 'File too large (max 20MB)')
  }

  const id = crypto.randomUUID()
  const ext = extForMime(file.type)
  const storedName = `${id}.${ext}`

  const buffer = await file.arrayBuffer()
  await Bun.write(getUploadPath(storedName), buffer)

  return json({ id: storedName, filename: file.name, mimeType: file.type, url: `/api/uploads/${storedName}` })
}
