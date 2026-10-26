import { parseModelRef } from '#lib/model-ref.ts'
import { getDecryptedKey } from '#lib/server/api-key.ts'
import { requireUser } from '#lib/server/auth-guard.ts'
import { mapUserSettings } from '#lib/server/db/records.ts'
import { getFirstOrNull, pb } from '#lib/server/pb.ts'
import { getProviderFactory } from '#lib/server/providers/index.ts'
import { translate } from '#lib/server/translator.ts'
import { DEFAULT_CONTEXTS, isSpeakerGender, LANGUAGES } from '#lib/translator.ts'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body: unknown = await request.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('text' in body) ||
    !('source' in body) ||
    !('target' in body) ||
    typeof body.text !== 'string' ||
    typeof body.source !== 'string' ||
    typeof body.target !== 'string' ||
    !body.text.trim() ||
    body.text.length > 6000 ||
    !LANGUAGES.some(language => language.code === body.source) ||
    !LANGUAGES.some(language => language.code === body.target) ||
    body.source === body.target
  ) {
    throw error(400, 'Enter text and select two different languages')
  }
  const { text, source, target } = body
  const additionalContext = 'additionalContext' in body ? body.additionalContext : ''
  if (typeof additionalContext !== 'string' || additionalContext.length > 2000) {
    throw error(400, 'Message context must be text of at most 2000 characters')
  }
  const speakerGender = 'speakerGender' in body ? body.speakerGender : 'unspecified'
  const recipientGender = 'recipientGender' in body ? body.recipientGender : 'unspecified'
  if (!isSpeakerGender(speakerGender) || !isSpeakerGender(recipientGender)) {
    throw error(400, 'Select valid speaker and recipient genders')
  }
  const settings = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )
  if (!settings?.translationModel) {
    throw error(400, 'Choose a translation model in Settings → Translator first')
  }
  const contextId = 'contextId' in body ? body.contextId : undefined
  const context = (settings.translationContexts ?? DEFAULT_CONTEXTS).find(entry => entry.id === contextId)
  const { provider, model } = parseModelRef(settings.translationModel)
  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) {
    throw error(400, 'Add an API key for your translation model in Settings')
  }
  const llm = getProviderFactory(provider)(apiKey)
  const abort = new AbortController()
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(90_000)])
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start: async controller => {
      try {
        for await (const event of translate(llm, { model, text, source, target, speakerGender, recipientGender, context: context?.content ?? '', additionalContext, signal })) {
          if (signal.aborted) {
            break
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        }
      } catch (err) {
        if (!signal.aborted) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', stage: 'translation', text: err instanceof Error ? err.message : 'Translation failed' })}\n`))
        }
      } finally {
        if (!abort.signal.aborted) {
          controller.close()
        }
      }
    },
    cancel: () => abort.abort(),
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } })
}
