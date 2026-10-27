import type { ChatRequest, ChatStreamEvent, LLMProvider } from './providers/types'
import { translate } from './translator'
import { describe, expect, it } from 'vitest'

type Stage = 'translation' | 'back' | 'notes'
type Reply = string | ChatStreamEvent[]

const senderNote = { phrase: 'farang', note: 'Kept as ฝรั่ง, the everyday Thai word for Westerners; said like this it can sound slightly dismissive.' }
const recipientNote = { phrase: 'ฝรั่ง', note: 'ผู้ส่งเขียนคำไทย farang ในประโยคภาษาอังกฤษเอง ไม่ได้ใช้คำว่า Westerner' }
const notes = { sender: [senderNote], recipient: [recipientNote] }
const translationOutput = (translation = 'ทำไมถึงเดทกับฝรั่ง') => JSON.stringify({ translation })
const notesOutput = (sender: unknown[] = notes.sender, recipient: unknown[] = notes.recipient) => JSON.stringify({ review: 'farang: Thai loanword in English, code switching', sender, recipient })
const backOutput = JSON.stringify({ translation: 'Why are you dating a Westerner?' })

const stageOf = (request: ChatRequest): Stage => {
  if (request.systemPrompt?.startsWith('Translate')) {
    return 'translation'
  }
  return request.systemPrompt?.startsWith('Independently') ? 'back' : 'notes'
}

const createProvider = (replies: Record<Stage, Reply[]>) => {
  const requests: Record<Stage, ChatRequest[]> = { translation: [], back: [], notes: [] }
  const provider: LLMProvider = {
    id: 'test',
    name: 'Test',
    capabilities: [],
    listModels: async () => [],
    chat: async function* (request) {
      const stage = stageOf(request)
      const reply = replies[stage][requests[stage].length]
      requests[stage].push(request)
      if (typeof reply === 'string') {
        yield { type: 'text_delta', text: reply }
      } else {
        for (const event of reply ?? []) {
          yield event
        }
      }
      yield { type: 'done' }
    },
  }
  return { provider, requests }
}

const valid = { translation: [translationOutput()], back: [backOutput], notes: [notesOutput()] }

const collect = async (provider: LLMProvider, speakerGender: 'unspecified' | 'female' | 'male' | 'neutral' = 'unspecified', recipientGender: 'unspecified' | 'female' | 'male' | 'neutral' = 'unspecified', additionalContext = '') => {
  const events = []
  for await (const event of translate(provider, { model: 'test', text: 'why are you dating a farang?', source: 'en', target: 'th', context: 'An early date', speakerGender, recipientGender, additionalContext })) {
    events.push(event)
  }
  return events
}

describe('translation pipeline', () => {
  it('publishes the translation first, then separate sender and recipient notes and an independent meaning check', async () => {
    const { provider, requests } = createProvider(valid)
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'ทำไมถึงเดทกับฝรั่ง' })
    expect(events).toContainEqual({ type: 'notes', notes })
    expect(events).toContainEqual({ type: 'back', text: 'Why are you dating a Westerner?' })
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(events).toHaveLength(4)
    expect(requests.translation[0].outputSchema?.schema.required).toEqual(['translation'])
    expect(requests.notes[0].outputSchema?.schema.required).toEqual(['review', 'sender', 'recipient'])
  })

  it('explains notes by comparing the original with the final translation in its situation', async () => {
    const additionalContext = '  She told me her parents disapprove.  '
    const { provider, requests } = createProvider(valid)
    await collect(provider, 'unspecified', 'unspecified', additionalContext)
    expect(JSON.parse(requests.notes[0].messages[0].content)).toEqual({ original: 'why are you dating a farang?', translation: 'ทำไมถึงเดทกับฝรั่ง', situation: 'An early date', background: additionalContext.trim() })
    expect(requests.notes[0].systemPrompt).toContain('English')
    expect(requests.notes[0].systemPrompt).toContain('Thai')
  })

  it('never publishes the private review', async () => {
    const { provider } = createProvider(valid)
    const events = await collect(provider)
    expect(JSON.stringify(events)).not.toContain('code switching')
  })

  it('keeps the meaning check blind to the original, situation, background, and genders', async () => {
    const additionalContext = 'She told me her parents disapprove.'
    const { provider, requests } = createProvider(valid)
    await collect(provider, 'female', 'male', additionalContext)
    expect(requests.back[0].messages).toEqual([{ role: 'user', content: 'ทำไมถึงเดทกับฝรั่ง' }])
    const meaningCheck = JSON.stringify(requests.back[0])
    for (const hidden of ['why are you dating', 'An early date', additionalContext, 'Speaker gender']) {
      expect(meaningCheck).not.toContain(hidden)
    }
  })

  it('keeps background out of the translated text', async () => {
    const additionalContext = '  She told me her parents disapprove.  '
    const { provider, requests } = createProvider(valid)
    await collect(provider, 'unspecified', 'unspecified', additionalContext)
    expect(JSON.parse(requests.translation[0].messages[0].content)).toEqual({ text: 'why are you dating a farang?', additionalContext: additionalContext.trim() })
    expect(requests.translation[0].systemPrompt).not.toContain(additionalContext.trim())
  })

  it('keeps the three most important notes per side', async () => {
    const many = Array.from({ length: 5 }, (_, n) => ({ phrase: `word ${n}`, note: `Meaning ${n}.` }))
    const { provider } = createProvider({ ...valid, notes: [notesOutput(many, [])] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'notes', notes: { sender: many.slice(0, 3), recipient: [] } })
  })

  it.each(['{"review":"","sender":[', notesOutput([{ phrase: 'farang' }]), notesOutput([{ ...senderNote, note: 'Thinking. '.repeat(100) }]), JSON.stringify({ sender: [], recipient: [] })])('retries invalid notes: %j', async invalid => {
    const { provider, requests } = createProvider({ ...valid, notes: [invalid, notesOutput()] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'notes', notes })
    expect(requests.notes).toHaveLength(2)
  })

  it.each(['\n', '\r\n', '\t', '\u0000'])('accepts unescaped control characters inside JSON strings: %j', async character => {
    const review = `Private review.${character}Thai loanword.`
    const sender = [{ phrase: 'farang', note: `Kept as ฝรั่ง.${character}An everyday Thai word.` }]
    const output = JSON.stringify({ review, sender, recipient: [] }).replaceAll(JSON.stringify(character).slice(1, -1), character)
    const { provider, requests } = createProvider({ ...valid, notes: [output] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'notes', notes: { sender, recipient: [] } })
    expect(requests.notes).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('Private review')
  })

  it('preserves escaped quotes, backslashes, and formatting outside JSON strings', async () => {
    const sender = [{ phrase: '"farang"', note: 'Quoted as "ฝรั่ง"; not a path like C:\\notes.' }]
    const output = JSON.stringify({ review: 'A review.\nAnother line.', sender, recipient: [] }, null, 2)
    const { provider } = createProvider({ ...valid, notes: [output] })
    expect(await collect(provider)).toContainEqual({ type: 'notes', notes: { sender, recipient: [] } })
  })

  it('gives the model its malformed response to repair instead of repeating the original request', async () => {
    const invalid = '{"review":"Private review", "sender":['
    const { provider, requests } = createProvider({ ...valid, notes: [invalid, notesOutput()] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'notes', notes })
    expect(requests.notes[1].messages).toEqual([...requests.notes[0].messages, { role: 'assistant', content: invalid }, { role: 'user', content: expect.stringContaining('Invalid JSON') }])
    expect(requests.notes[1].messages[2].content).toContain('complete JSON object')
    expect(JSON.stringify(events)).not.toContain('Private review')
  })

  it('retries an empty response without sending an empty assistant message', async () => {
    const { provider, requests } = createProvider({ ...valid, notes: ['', notesOutput()] })
    expect(await collect(provider)).toContainEqual({ type: 'notes', notes })
    expect(requests.notes[1].messages.every(message => message.content.trim())).toBe(true)
    expect(requests.notes[1].messages.at(-1)?.role).toBe('user')
  })

  it.each(['{"review":"unfinished', '{"review":"done","sender":[],"recipient":[', '{"review":"unescaped "quote"","sender":[],"recipient":[]}'])('does not invent missing or ambiguous note content: %j', async invalid => {
    const { provider } = createProvider({ ...valid, notes: [invalid, invalid] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'error', stage: 'notes', text: expect.stringContaining('Invalid JSON') })
    expect(events.some(event => event.type === 'notes')).toBe(false)
    expect(events).toContainEqual({ type: 'back', text: 'Why are you dating a Westerner?' })
  })

  it('tells the model which note failed validation before retrying', async () => {
    const invalid = notesOutput([{ ...senderNote, phrase: 'word '.repeat(25) }])
    const { provider, requests } = createProvider({ ...valid, notes: [invalid, notesOutput()] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'notes', notes })
    expect(requests.notes[1].systemPrompt).toContain('sender[0]')
    expect(requests.notes[1].systemPrompt).toContain('100 characters')
    expect(requests.notes[1].systemPrompt).toContain('400 characters')
  })

  it('reports the invalid note without exposing model output or the private review', async () => {
    const invalid = notesOutput([], [{ ...recipientNote, note: 'Private invalid content. '.repeat(30) }])
    const { provider } = createProvider({ ...valid, notes: [invalid, invalid] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'error', stage: 'notes', text: 'The model returned no context notes. Invalid recipient[0]: expected a nonempty phrase of at most 100 characters and a nonempty note of at most 400 characters.' })
    expect(JSON.stringify(events)).not.toContain('Private invalid content')
    expect(JSON.stringify(events)).not.toContain('code switching')
    expect(events).toContainEqual({ type: 'back', text: 'Why are you dating a Westerner?' })
  })

  it('retries invalid JSON after falling back from unsupported structured output', async () => {
    const { provider, requests } = createProvider({ ...valid, notes: [[{ type: 'error', error: 'Unsupported response_format' }], '{"sender":', notesOutput()] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'notes', notes })
    expect(requests.notes).toHaveLength(3)
    expect(requests.notes[1].outputSchema).toBeUndefined()
    expect(requests.notes[2].outputSchema).toBeUndefined()
    expect(requests.notes[2].systemPrompt).toContain('Invalid JSON')
  })

  it('keeps translation and meaning check when notes fail', async () => {
    const { provider } = createProvider({ ...valid, notes: [[{ type: 'error', error: 'Unavailable' }]] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'back', text: 'Why are you dating a Westerner?' })
    expect(events).toContainEqual({ type: 'error', stage: 'notes', text: 'Unavailable' })
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('keeps translation and notes when the meaning check fails', async () => {
    const { provider } = createProvider({ ...valid, back: [[{ type: 'error', error: 'Unavailable' }]] })
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'notes', notes })
    expect(events).toContainEqual({ type: 'error', stage: 'back', text: 'Unavailable' })
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('never exposes untagged deliberation and retries it as a structured final answer', async () => {
    const deliberation = 'Context: early date. Could avoid pronoun. A natural question: ทำไมถึงเดทกับฝรั่ง'
    const { provider, requests } = createProvider({ ...valid, translation: [deliberation, translationOutput()] })
    const events = await collect(provider)
    expect(JSON.stringify(events)).not.toContain('Could avoid pronoun')
    expect(events[0]).toEqual({ type: 'translation', text: 'ทำไมถึงเดทกับฝรั่ง' })
    expect(requests.translation).toHaveLength(2)
  })

  it('ignores thinking events and waits for the complete translation', async () => {
    const output = translationOutput()
    const { provider } = createProvider({
      ...valid,
      translation: [
        [
          { type: 'thinking_delta', thinking: 'Private model deliberation' },
          { type: 'text_delta', text: output.slice(0, 10) },
          { type: 'text_delta', text: output.slice(10) },
        ],
      ],
    })
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'ทำไมถึงเดทกับฝรั่ง' })
    expect(JSON.stringify(events)).not.toContain('Private model deliberation')
  })

  it.each(['', 'Thinking aloud. The final answer is Hello.', '{"translation":', translationOutput('<think>Use neutral pronouns</think>Hello')])('fails safely when no clean final answer is returned: %j', async invalid => {
    const { provider, requests } = createProvider({ ...valid, translation: [invalid, invalid] })
    const events = await collect(provider)
    expect(events).toEqual([{ type: 'error', stage: 'translation', text: expect.stringContaining('The model did not return a clean translation. Please try another model.') }])
    expect(requests.translation).toHaveLength(2)
    expect(requests.notes).toHaveLength(0)
  })

  it('accepts fenced JSON without displaying the wrapper', async () => {
    const { provider } = createProvider({ ...valid, translation: [`\`\`\`json\n${translationOutput()}\n\`\`\``] })
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'ทำไมถึงเดทกับฝรั่ง' })
  })

  it('falls back to validated JSON when a model has no structured-output endpoint', async () => {
    const { provider, requests } = createProvider({ ...valid, translation: [[{ type: 'error', error: 'No endpoints found that support the requested parameters' }], translationOutput()] })
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'ทำไมถึงเดทกับฝรั่ง' })
    expect(requests.translation[0].outputSchema?.name).toBe('translation')
    expect(requests.translation[1].outputSchema).toBeUndefined()
  })

  it('applies both genders to the translation', async () => {
    const { provider, requests } = createProvider(valid)
    await collect(provider, 'female', 'male')
    expect(requests.translation[0].systemPrompt).toContain('Speaker gender: female')
    expect(requests.translation[0].systemPrompt).toContain('Recipient gender: male')
    expect(requests.translation[0].systemPrompt).toContain('not the recipient')
  })
})
