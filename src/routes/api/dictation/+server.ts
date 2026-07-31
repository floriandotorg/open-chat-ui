import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { mapUserSettings } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { Mistral } from '@mistralai/mistralai'
import { error, json } from '@sveltejs/kit'

const audioFilename = (mimeType: string): string => {
  const subtype = mimeType.split(';')[0].split('/')[1] ?? 'webm'
  return `audio.${subtype === 'mpeg' ? 'mp3' : subtype}`
}

const transcribeWithMistral = async (userId: string, audio: File): Promise<string> => {
  const apiKey = await getDecryptedKey(userId, 'mistral')
  if (!apiKey) {
    throw error(400, 'No Mistral API key configured. Add one in Settings → API Keys.')
  }

  const client = new Mistral({ apiKey })
  const response = await client.audio.transcriptions.complete(
    {
      model: 'voxtral-mini-latest',
      file: { fileName: audioFilename(audio.type), content: audio },
    },
    { timeoutMs: 240_000 },
  )
  return response.text
}

const transcribeWithElevenLabs = async (userId: string, audio: File): Promise<string> => {
  const apiKey = await getDecryptedKey(userId, 'elevenlabs')
  if (!apiKey) {
    throw error(400, 'No ElevenLabs API key configured. Add one in Settings → Tools.')
  }

  const form = new FormData()
  form.append('model_id', 'scribe_v1')
  form.append('tag_audio_events', 'false')
  form.append('file', audio, audioFilename(audio.type))

  const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(240_000),
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
  const form = await request.formData()
  const audio = form.get('audio')

  if (!(audio instanceof File) || audio.size === 0) {
    throw error(400, 'No audio data provided')
  }

  const settings = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )
  const provider = settings?.dictationProvider ?? 'mistral'

  try {
    const text = provider === 'elevenlabs' ? await transcribeWithElevenLabs(userId, audio) : await transcribeWithMistral(userId, audio)
    return json({ text })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'RequestTimeoutError' || /timed\s*out/i.test(err.message))) {
      throw error(504, 'Transcription timed out')
    }
    throw err
  }
}
