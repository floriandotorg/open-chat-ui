import { requireUser } from '#lib/server/auth-guard.ts'
import { speechCache } from '#lib/server/speech-cache.ts'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = ({ request, locals, params }) => speechCache.respond(requireUser(locals.user).id, params.id, request)

export const HEAD = GET
