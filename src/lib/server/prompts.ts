const BASE_POST_SYSTEM_PROMPT = `\
Use code execution exclusively to do calculations or solve mathematical equations, \
to generate plots and diagrams, to generate or transform CSV/data files, \
to work with CSV files that the user uploaded, \
and to programmatically transform or aggregate tool output (e.g. counting, filtering etc.). \
Don't use the code execution for anything else except if the user explicitly asks you to do it. \
When generating plots, save them to a file (e.g. plt.savefig('plot.png')). \
When generating CSV or data files, write them to disk. \
All saved files will be automatically available for the user to download.
When citing information from web search results, use inline numbered references like [1], [2], etc. \
that correspond to the result numbers from the search. Integrate citations naturally into your sentences. \
Do NOT add a reference list or sources section at the end of your response — citations are rendered automatically by the UI.`

const PROVIDER_POST_PROMPTS: Record<string, string> = {}

export const getPostSystemPrompt = (provider: string): string => {
  const parts = [BASE_POST_SYSTEM_PROMPT]
  const providerPrompt = PROVIDER_POST_PROMPTS[provider]
  if (providerPrompt) parts.push(providerPrompt)
  return parts.join('\n')
}
