import { requireUser } from '#lib/server/auth-guard.ts'
import { mapUserSettings } from '#lib/server/db/records.ts'
import { getFirstOrNull, pb } from '#lib/server/pb.ts'
import { DEFAULT_CONTEXTS } from '#lib/translator.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const settings = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )
  return { userId, model: settings?.translationModel ?? null, contexts: settings?.translationContexts ?? DEFAULT_CONTEXTS }
}
