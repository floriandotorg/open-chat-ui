import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { userSettings } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { Mistral } from '@mistralai/mistralai'
import { error, json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

const transcribeWithMistral = async (userId: string, audio: string): Promise<string> => {
  const apiKey = await getDecryptedKey(userId, 'mistral')
  if (!apiKey) {
    throw error(400, 'No Mistral API key configured. Add one in Settings → API Keys.')
  }

  const client = new Mistral({ apiKey })
  const response = await client.chat.complete({
    model: 'voxtral-mini-latest',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'input_audio' as const, inputAudio: audio },
          { type: 'text' as const, text: 'Transcribe this audio exactly as spoken in its original language. Do not translate it to another language.' },
        ],
      },
    ],
  })

  const transcription = response.choices?.[0]?.message?.content
  if (typeof transcription !== 'string') {
    throw error(500, 'Failed to transcribe audio')
  }
  return transcription
}

const transcribeWithElevenLabs = async (userId: string, audio: string): Promise<string> => {
  const apiKey = await getDecryptedKey(userId, 'elevenlabs')
  if (!apiKey) {
    throw error(400, 'No ElevenLabs API key configured. Add one in Settings → Tools.')
  }

  const audioBytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0))
  const form = new FormData()
  form.append('model_id', 'scribe_v1')
  form.append('tag_audio_events', 'false')
  form.append('file', new Blob([audioBytes], { type: 'audio/wav' }), 'audio.wav')

  const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  })

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '')
    throw error(upstream.status, `ElevenLabs API error: ${body || upstream.statusText}`)
  }

  const data = (await upstream.json()) as { text?: unknown }
  if (typeof data.text !== 'string') {
    throw error(500, 'Failed to transcribe audio')
  }
  return data.text
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { audio } = (await request.json()) as { audio: string }

  if (!audio) {
    throw error(400, 'No audio data provided')
  }

  const [settings] = await db.select({ dictationProvider: userSettings.dictationProvider }).from(userSettings).where(eq(userSettings.userId, userId))
  const provider = settings?.dictationProvider ?? 'mistral'

  const text = provider === 'elevenlabs' ? await transcribeWithElevenLabs(userId, audio) : await transcribeWithMistral(userId, audio)
  return json({ text })
}
