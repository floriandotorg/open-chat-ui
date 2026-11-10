import { requireUser } from '#lib/server/auth-guard.ts'
import { loadBrowserHost } from '#lib/server/browser/config.ts'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const host = await loadBrowserHost(userId)
  if ('error' in host) {
    return json({ ok: false, error: host.error })
  }
  try {
    return json({ ok: true, health: await host.health() })
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'The browser host is unreachable.' })
  }
}
