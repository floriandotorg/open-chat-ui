import { requireUser } from '$lib/server/auth-guard'
import { pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
  const userId = requireUser(locals.user).id
  const keyId = url.searchParams.get('keyId')

  const filter = keyId ? pb.filter('user = {:u} && provider = {:p} && id = {:i}', { u: userId, p: params.provider, i: keyId }) : pb.filter('user = {:u} && provider = {:p}', { u: userId, p: params.provider })

  const rows = await pb.collection('api_keys').getFullList({ filter, fields: 'id' })

  if (rows.length === 0) {
    throw error(404, 'API key not found')
  }

  await Promise.all(rows.map(row => pb.collection('api_keys').delete(row.id)))

  return new Response(null, { status: 204 })
}
