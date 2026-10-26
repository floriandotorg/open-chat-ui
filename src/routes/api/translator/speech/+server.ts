import { getDecryptedKey } from '#lib/server/api-key.ts'
import { requireUser } from '#lib/server/auth-guard.ts'
import { LANGUAGES } from '#lib/translator.ts'
import type { RequestHandler } from './$types'
import { Mistral } from '@mistralai/mistralai'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body: unknown = await request.json()
  if (typeof body !== 'object' || body === null || !('language' in body) || !LANGUAGES.some(language => language.code === body.language)) {
    throw error(400, 'Invalid source language')
  }
  const provider = body.language === 'th' ? 'elevenlabs' : 'mistral'
  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) {
    throw error(400, `Add a ${provider === 'mistral' ? 'Mistral' : 'ElevenLabs'} API key in Settings to use live transcription`)
  }
  if (provider === 'elevenlabs') {
    const response = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw error(502, 'ElevenLabs could not start live transcription. Check your API key and credits.')
    }
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null || !('token' in data) || typeof data.token !== 'string') {
      throw error(502, 'ElevenLabs returned an invalid session')
    }
    return json({ provider, token: data.token }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const model = 'voxtral-mini-transcribe-realtime-2602'
  const session = await new Mistral({ apiKey }).realtime.sessions.create({ purpose: 'realtime', model, ttlSeconds: 300 })
  return json({ provider, model, token: session.clientSecret.value }, { headers: { 'Cache-Control': 'no-store' } })
}
