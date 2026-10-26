import { normalizeModelRef } from '#lib/model-ref.ts'
import { requireUser } from '#lib/server/auth-guard.ts'
import { mapUserSettings, now, type UserSettings } from '#lib/server/db/records.ts'
import { createOrRecover, getFirstOrNull, pb } from '#lib/server/pb.ts'
import { DEFAULT_CONTEXTS, parseContexts } from '#lib/translator.ts'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

const toSettings = (row: UserSettings) => ({
  defaultSystemPrompt: row.defaultSystemPrompt,
  defaultModel: normalizeModelRef(row.defaultProvider, row.defaultModel),
  titleModel: row.titleModel,
  toolSummarizerModel: row.toolSummarizerModel,
  dictationProvider: row.dictationProvider ?? 'mistral',
  translationModel: row.translationModel ?? null,
  translationContexts: row.translationContexts ?? DEFAULT_CONTEXTS,
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
          translationModel: null,
          translationContexts: DEFAULT_CONTEXTS,
        },
  )
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()
  if (body.translationModel !== undefined && body.translationModel !== null && (typeof body.translationModel !== 'string' || body.translationModel.length > 500 || !/^[^/]+\/.+$/.test(body.translationModel))) {
    throw error(400, 'Invalid translation model')
  }
  if (body.translationContexts !== undefined && !parseContexts(body.translationContexts)) {
    throw error(400, 'Invalid translation contexts')
  }
  const translationFields = {
    ...(body.translationModel !== undefined && { translationModel: body.translationModel }),
    ...(body.translationContexts !== undefined && { translationContexts: body.translationContexts }),
  }

  const existing = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )

  if (existing) {
    const updated = await pb.collection('user_settings').update(existing.id, {
      ...translationFields,
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
      ...translationFields,
      defaultSystemPrompt: body.defaultSystemPrompt ?? null,
      defaultModel: body.defaultModel ?? null,
      titleModel: body.titleModel ?? null,
      toolSummarizerModel: body.toolSummarizerModel ?? null,
      dictationProvider: body.dictationProvider ?? 'mistral',
      updatedAt: now(),
    },
    pb.filter('user = {:u}', { u: userId }),
    {
      ...translationFields,
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
