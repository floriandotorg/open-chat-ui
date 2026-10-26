import type { ChatRequest, ChatStreamEvent, LLMProvider } from './providers/types'
import { translate } from './translator'
import { describe, expect, it } from 'vitest'

const contextNote = { phrase: 'girlfriend', source: 'A romantic partner, not a female friend.', target: 'หมายถึงคนรัก ไม่ใช่เพื่อนผู้หญิง' }
const translationOutput = (translation = 'เป็นแฟนกันไหม', notes = [contextNote]) => JSON.stringify({ translation, notes })
const backOutput = JSON.stringify({ translation: 'Do you want to be my partner?' })

const createProvider = (replies: (string | ChatStreamEvent[])[]) => {
  const requests: ChatRequest[] = []
  const provider: LLMProvider = {
    id: 'test',
    name: 'Test',
    capabilities: [],
    listModels: async () => [],
    chat: async function* (request) {
      const reply = replies[requests.length]
      requests.push(request)
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

const collect = async (provider: LLMProvider, speakerGender: 'unspecified' | 'female' | 'male' | 'neutral' = 'unspecified', recipientGender: 'unspecified' | 'female' | 'male' | 'neutral' = 'unspecified', additionalContext = '') => {
  const events = []
  for await (const event of translate(provider, { model: 'test', text: 'Will you be my girlfriend?', source: 'en', target: 'th', context: 'Close relationships', speakerGender, recipientGender, additionalContext })) {
    events.push(event)
  }
  return events
}

describe('translation pipeline', () => {
  it('generates the translation and bilingual context together, then checks only the final translation independently', async () => {
    const { provider, requests } = createProvider([translationOutput(), backOutput])
    const events = await collect(provider)
    expect(events).toEqual([{ type: 'translation', text: 'เป็นแฟนกันไหม' }, { type: 'note', notes: [contextNote] }, { type: 'back', text: 'Do you want to be my partner?' }, { type: 'done' }])
    expect(requests).toHaveLength(2)
    expect(requests[0].outputSchema?.schema.required).toEqual(['translation', 'notes'])
    expect(requests[1].messages).toEqual([{ role: 'user', content: 'เป็นแฟนกันไหม' }])
    expect(requests[1].systemPrompt).not.toContain('Will you be my girlfriend?')
    expect(requests[1].systemPrompt).not.toContain('Close relationships')
  })

  it('keeps message context separate from the source text and out of the independent meaning check', async () => {
    const additionalContext = '  The previous message asked whether I meant friendship or dating.  '
    const { provider, requests } = createProvider([translationOutput(), backOutput])
    await collect(provider, 'unspecified', 'unspecified', additionalContext)
    expect(JSON.parse(requests[0].messages[0].content)).toEqual({ text: 'Will you be my girlfriend?', additionalContext: additionalContext.trim() })
    expect(requests[0].systemPrompt).not.toContain(additionalContext.trim())
    expect(requests[1].messages).toEqual([{ role: 'user', content: 'เป็นแฟนกันไหม' }])
    expect(JSON.stringify(requests[1])).not.toContain(additionalContext.trim())
  })

  it('publishes bilingual tone and cultural explanations without mixing them into the translation', async () => {
    const notes = [
      { phrase: 'girlfriend', source: 'This asks for a romantic relationship, not friendship.', target: 'เป็นการขอเริ่มความสัมพันธ์แบบคนรัก ไม่ใช่เพื่อน' },
      { phrase: 'Will you be my girlfriend?', source: 'The direct question sounds sincere and affectionate, not like an order.', target: 'คำถามตรงไปตรงมานี้ฟังดูจริงใจและอ่อนโยน ไม่ใช่คำสั่ง' },
    ]
    const { provider } = createProvider([translationOutput('เป็นแฟนกันไหม', notes), backOutput])
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'เป็นแฟนกันไหม' })
    expect(events).toContainEqual({ type: 'note', notes })
  })

  it('never exposes untagged deliberation and retries it as a structured final answer', async () => {
    const deliberation = 'Context: stranger on street or hotel check-in. Use neutral pronouns. Could avoid pronoun. A natural question: เป็นแฟนกันไหม'
    const { provider, requests } = createProvider([deliberation, translationOutput(), backOutput])
    const events = await collect(provider)
    expect(JSON.stringify(events)).not.toContain('Could avoid pronoun')
    expect(events[0]).toEqual({ type: 'translation', text: 'เป็นแฟนกันไหม' })
    expect(requests).toHaveLength(3)
  })

  it('ignores thinking events and waits for the complete translation and context object', async () => {
    const output = translationOutput('เป็นแฟนกันไหม', [])
    const { provider } = createProvider([
      [
        { type: 'thinking_delta', thinking: 'Private model deliberation' },
        { type: 'text_delta', text: output.slice(0, 20) },
        { type: 'text_delta', text: output.slice(20) },
      ],
      backOutput,
    ])
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'เป็นแฟนกันไหม' })
    expect(JSON.stringify(events)).not.toContain('Private model deliberation')
    expect(events).toContainEqual({ type: 'note', notes: [] })
  })

  it.each(['', 'Thinking aloud. The final answer is Hello.', '{"translation":', translationOutput('<think>Use neutral pronouns</think>Hello')])('fails safely when no clean final answer is returned: %j', async invalid => {
    const { provider, requests } = createProvider([invalid, invalid])
    const events = await collect(provider)
    expect(events).toEqual([{ type: 'error', stage: 'translation', text: 'The model did not return a clean translation. Please try another model.' }])
    expect(requests).toHaveLength(2)
  })

  it.each(['{"translation":"Hello","notes":[', translationOutput('Hello', [{ ...contextNote, source: 'Thinking. '.repeat(100) }]), '{"translation":"Hello","notes":[{"phrase":"girlfriend","source":"Missing target language"}]}'])(
    'retries incomplete or verbose context without publishing raw output: %j',
    async invalid => {
      const { provider, requests } = createProvider([invalid, translationOutput(), backOutput])
      const events = await collect(provider)
      expect(events[0]).toEqual({ type: 'translation', text: 'เป็นแฟนกันไหม' })
      expect(events).toContainEqual({ type: 'note', notes: [contextNote] })
      expect(events.some(event => event.type === 'error')).toBe(false)
      expect(requests).toHaveLength(3)
    },
  )

  it('accepts fenced JSON without displaying the wrapper', async () => {
    const { provider } = createProvider([`\`\`\`json\n${translationOutput()}\n\`\`\``, backOutput])
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'เป็นแฟนกันไหม' })
  })

  it('keeps translation and context when the independent meaning check fails', async () => {
    const { provider } = createProvider([translationOutput(), [{ type: 'error', error: 'Unavailable' }]])
    const events = await collect(provider)
    expect(events).toContainEqual({ type: 'note', notes: [contextNote] })
    expect(events).toContainEqual({ type: 'error', stage: 'back', text: 'Unavailable' })
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('falls back to validated JSON when a model has no structured-output endpoint', async () => {
    const { provider, requests } = createProvider([[{ type: 'error', error: 'No endpoints found that support the requested parameters' }], translationOutput(), backOutput])
    const events = await collect(provider)
    expect(events[0]).toEqual({ type: 'translation', text: 'เป็นแฟนกันไหม' })
    expect(requests[0].outputSchema?.name).toBe('translation_with_context')
    expect(requests[1].outputSchema).toBeUndefined()
    expect(events).toContainEqual({ type: 'note', notes: [contextNote] })
  })

  it('applies both genders without sending either setting to the independent meaning check', async () => {
    const { provider, requests } = createProvider([translationOutput(), backOutput])
    await collect(provider, 'female', 'male')
    expect(requests[0].systemPrompt).toContain('Speaker gender: female')
    expect(requests[0].systemPrompt).toContain('Recipient gender: male')
    expect(requests[0].systemPrompt).toContain('not the recipient')
    expect(requests[1].systemPrompt).not.toContain('Speaker gender: female')
    expect(requests[1].systemPrompt).not.toContain('Recipient gender: male')
  })
})
