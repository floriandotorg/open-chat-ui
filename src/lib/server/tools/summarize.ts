import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { mapUserSettings } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import { getProviderFactory } from '$lib/server/providers'
import type { ToolContext, ToolDefinition } from './types'

const MIN_CHARS = 2000
const MAX_INPUT_CHARS = 200_000
const MAX_OUTPUT_TOKENS = 8000

const SYSTEM_PROMPT = `You distill raw search-tool output for another AI model. Given a research question and raw results, write a condensed briefing of everything that bears on the question.

Rules:
- Keep all facts, figures, dates, quotes, names, and source details relevant to the research question. Cut only noise: boilerplate, ads, navigation, repetition, irrelevant passages. The briefing may be extensive when the sources are rich — relevance, not length, is the criterion.
- Keep every source you draw on as a numbered markdown list item in the exact format "n. [title](url)", preserving the original numbering from the input. Never renumber, merge, or reformat these entries — downstream citation handling depends on them.
- Output only the briefing, no preamble or meta-commentary.`

const buildUserPrompt = (researchQuestion: string, rawResult: string): string => {
  const truncated = rawResult.length > MAX_INPUT_CHARS ? `${rawResult.slice(0, MAX_INPUT_CHARS)}\n\n[... truncated]` : rawResult
  return `Research question:\n${researchQuestion}\n\nRaw search results:\n${truncated}`
}

export const summarizeSearchResult = async (userId: string, researchQuestion: string, rawResult: string): Promise<string> => {
  if (rawResult.length < MIN_CHARS || rawResult.startsWith('Error:')) return rawResult

  try {
    const settings = await getFirstOrNull(
      pb
        .collection('user_settings')
        .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
        .then(mapUserSettings),
    )
    if (!settings?.toolSummarizerModel) return rawResult

    const { provider, model } = parseModelRef(settings.toolSummarizerModel)
    const apiKey = await getDecryptedKey(userId, provider)
    if (!apiKey) return rawResult

    const llm = getProviderFactory(provider)(apiKey)
    let summary = ''
    let failed = false
    for await (const event of llm.chat({
      model,
      messages: [{ role: 'user', content: buildUserPrompt(researchQuestion, rawResult) }],
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      thinkingEffort: 'none',
    })) {
      if (event.type === 'text_delta') summary += event.text ?? ''
      if (event.type === 'error') failed = true
    }

    summary = summary.trim()
    if (failed || !summary) return rawResult
    return summary
  } catch {
    return rawResult
  }
}

export const withSearchSummarization = (tool: ToolDefinition): ToolDefinition => ({
  ...tool,
  description: `${tool.description}\n\nRaw results are filtered and summarized by a separate model against your research_question before being returned.`,
  parameters: {
    ...tool.parameters,
    properties: {
      ...tool.parameters.properties,
      research_question: {
        type: 'string',
        description: 'The precise research question this search should answer. Results are filtered and summarized against it before you see them, so be specific about what you need.',
      },
    },
    required: [...(tool.parameters.required ?? []), 'research_question'],
  },
  execute: async (args: Record<string, unknown>, context: ToolContext) => {
    const out = await tool.execute(args, context)
    const raw = typeof out === 'string' ? out : out.result
    const question = typeof args.research_question === 'string' ? args.research_question.trim() : ''
    if (!question) return out
    const summary = await summarizeSearchResult(context.userId, question, raw)
    if (summary === raw) return out
    return { result: summary, rawResult: raw }
  },
})
