import { requireUser } from '$lib/server/auth-guard'
import { decrypt } from '$lib/server/crypto'
import { mapApiKey } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import Anthropic from '@anthropic-ai/sdk'
import { error } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, locals, url }) => {
  const userId = requireUser(locals.user).id

  const keyRow = await getFirstOrNull(
    pb
      .collection('api_keys')
      .getFirstListItem(pb.filter('user = {:u} && provider = "anthropic"', { u: userId }), { sort: 'createdAt' })
      .then(mapApiKey),
  )

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
