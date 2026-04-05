const BASE_POST_SYSTEM_PROMPT = `\
Use code execution exclusively to do calculations or solve mathematical equations, \
to generate plots and diagrams, to work with CSV files that the user uploaded, \
and to programmatically transform or aggregate tool output (e.g. counting, filtering etc.). \
Don't use the code execution for anything else except if the user explicitly asks you to do it.`

const PROVIDER_POST_PROMPTS: Record<string, string> = {}

export const getPostSystemPrompt = (provider: string): string => {
  const parts = [BASE_POST_SYSTEM_PROMPT]
  const providerPrompt = PROVIDER_POST_PROMPTS[provider]
  if (providerPrompt) parts.push(providerPrompt)
  return parts.join('\n')
}
