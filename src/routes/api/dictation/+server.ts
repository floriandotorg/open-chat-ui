import { requireUser } from '$lib/server/auth-guard'
import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { Mistral } from '@mistralai/mistralai'
import { error, json } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { audio } = (await request.json()) as { audio: string }

  if (!audio) {
    throw error(400, 'No audio data provided')
  }

  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, 'mistral')))

  if (!keyRow) {
    throw error(400, 'No Mistral API key configured. Add one in Settings → API Keys.')
  }

  const apiKey = await decrypt(keyRow.encryptedKey, keyRow.iv)
  const client = new Mistral({ apiKey })

  const response = await client.chat.complete({
    model: 'voxtral-small-latest',
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

  return json({ text: transcription })
}
