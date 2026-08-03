import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { mapUserSettings, now, type UserSettings } from '$lib/server/db/records'
import { createOrRecover, getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

const toSettings = (row: UserSettings) => ({
  defaultSystemPrompt: row.defaultSystemPrompt,
  defaultModel: normalizeModelRef(row.defaultProvider, row.defaultModel),
  titleModel: row.titleModel,
  toolSummarizerModel: row.toolSummarizerModel,
  dictationProvider: row.dictationProvider ?? 'mistral',
})

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const settings = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )

  return json(
    settings
      ? toSettings(settings)
      : {
          defaultSystemPrompt: null,
          defaultModel: null,
          titleModel: null,
          toolSummarizerModel: null,
          dictationProvider: 'mistral',
        },
  )
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const existing = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )

  if (existing) {
    const updated = await pb.collection('user_settings').update(existing.id, {
      ...(body.defaultSystemPrompt !== undefined && { defaultSystemPrompt: body.defaultSystemPrompt }),
      ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
      ...(body.titleModel !== undefined && { titleModel: body.titleModel }),
      ...(body.toolSummarizerModel !== undefined && { toolSummarizerModel: body.toolSummarizerModel }),
      ...(body.dictationProvider !== undefined && { dictationProvider: body.dictationProvider }),
      updatedAt: now(),
    })
    return json(toSettings(mapUserSettings(updated)))
  }

  const created = await createOrRecover(
    'user_settings',
    {
      user: userId,
      defaultSystemPrompt: body.defaultSystemPrompt ?? null,
      defaultModel: body.defaultModel ?? null,
      titleModel: body.titleModel ?? null,
      toolSummarizerModel: body.toolSummarizerModel ?? null,
      dictationProvider: body.dictationProvider ?? 'mistral',
      updatedAt: now(),
    },
    pb.filter('user = {:u}', { u: userId }),
    {
      ...(body.defaultSystemPrompt !== undefined && { defaultSystemPrompt: body.defaultSystemPrompt }),
      ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
      ...(body.titleModel !== undefined && { titleModel: body.titleModel }),
      ...(body.toolSummarizerModel !== undefined && { toolSummarizerModel: body.toolSummarizerModel }),
      ...(body.dictationProvider !== undefined && { dictationProvider: body.dictationProvider }),
      updatedAt: now(),
    },
  )

  return json(toSettings(mapUserSettings(created)))
}
