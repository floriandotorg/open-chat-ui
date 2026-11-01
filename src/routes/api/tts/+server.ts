import { getDecryptedKey } from '#lib/server/api-key.ts'
import { requireUser } from '#lib/server/auth-guard.ts'
import { SPEECH_CACHE_TTL_MS, speechCache } from '#lib/server/speech-cache.ts'
import { LANGUAGES } from '#lib/translator.ts'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body: unknown = await request.json()
  if (typeof body !== 'object' || body === null || !('text' in body) || typeof body.text !== 'string' || !body.text.trim()) {
    throw error(400, 'Text is required')
  }
  const { text } = body
  const language = 'language' in body ? body.language : undefined
  if (language !== undefined && (typeof language !== 'string' || !LANGUAGES.some(entry => entry.code === language))) {
    throw error(400, 'Unsupported speech language')
  }
  if (language !== undefined && text.length > 10000) {
    throw error(400, 'Speech supports up to 10,000 characters. Shorten the text and translate again.')
  }

  const [apiKey, voiceId] = await Promise.all([getDecryptedKey(userId, 'elevenlabs'), language === 'pt-PT' ? 'ID3DiXGPB7uwug5tZ3FB' : getDecryptedKey(userId, 'elevenlabs-voice-id')])

  if (!apiKey) {
    throw error(400, 'No ElevenLabs API key configured. Add one in Settings → Tools.')
  }
  if (!voiceId) {
    throw error(400, 'No ElevenLabs Voice ID configured. Add one in Settings → Tools.')
  }

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      text: language ? text : text.slice(0, 5000),
      model_id: language === 'th' ? 'eleven_v4' : language ? 'eleven_flash_v2_5' : 'eleven_multilingual_v2',
      ...(typeof language === 'string' ? { language_code: language.split('-')[0] } : {}),
    }),
  })

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '')
    throw error(upstream.status, `ElevenLabs API error: ${body ? body : upstream.statusText}`)
  }

  if (!upstream.body) {
    throw error(502, 'ElevenLabs returned no audio')
  }

  const id = speechCache.create(userId, upstream.body)
  return json({ url: `/api/tts/${id}`, expiresAt: Date.now() + SPEECH_CACHE_TTL_MS }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
}
