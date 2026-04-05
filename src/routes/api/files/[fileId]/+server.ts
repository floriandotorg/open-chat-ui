import { requireUser } from '$lib/server/auth-guard'
import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import Anthropic from '@anthropic-ai/sdk'
import { error } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ params, locals, url }) => {
  const userId = requireUser(locals.user).id

  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, 'anthropic')))

  if (!keyRow) {
    throw error(400, 'No Anthropic API key configured')
  }

  const decryptedKey = await decrypt(keyRow.encryptedKey, keyRow.iv)
  const client = new Anthropic({ apiKey: decryptedKey })

  const metadata = await client.beta.files.retrieveMetadata(params.fileId)
  const fileResponse = await client.beta.files.download(params.fileId)
  const bytes = Buffer.from(await fileResponse.arrayBuffer())

  const inline = url.searchParams.get('inline') === '1'
  const disposition = inline ? 'inline' : `attachment; filename="${metadata.filename}"`

  return new Response(bytes, {
    headers: {
      'Content-Type': metadata.mime_type ?? 'application/octet-stream',
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
