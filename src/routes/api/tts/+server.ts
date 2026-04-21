import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { text } = (await request.json()) as { text: string }

  if (!text?.trim()) {
    throw error(400, 'Text is required')
  }

  const [apiKey, voiceId] = await Promise.all([getDecryptedKey(userId, 'elevenlabs'), getDecryptedKey(userId, 'elevenlabs-voice-id')])

  if (!apiKey) {
    throw error(400, 'No ElevenLabs API key configured. Add one in Settings → Tools.')
  }
  if (!voiceId) {
    throw error(400, 'No ElevenLabs Voice ID configured. Add one in Settings → Tools.')
  }

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: 'eleven_multilingual_v2',
    }),
  })

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '')
    throw error(upstream.status, `ElevenLabs API error: ${body || upstream.statusText}`)
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
