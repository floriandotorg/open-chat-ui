export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

type RawPricing = {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_read_input_token_cost?: number
  cache_creation_input_token_cost?: number
  input_cost_per_token_cache_hit?: number
}

const PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/model_prices_and_context_window.json'
const TTL_MS = 6 * 60 * 60 * 1000

let cache: { data: Record<string, RawPricing>; at: number } | null = null
let pending: Promise<Record<string, RawPricing>> | null = null

const fetchPricing = async (): Promise<Record<string, RawPricing>> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  if (pending) return pending
  pending = fetch(PRICING_URL)
    .then(async r => {
      if (!r.ok) throw new Error(`pricing fetch failed: ${r.status}`)
      const data = (await r.json()) as Record<string, RawPricing>
      cache = { data, at: Date.now() }
      pending = null
      return data
    })
    .catch(err => {
      pending = null
      throw err
    })
  return pending
}

const lookup = (data: Record<string, RawPricing>, key: string): RawPricing | undefined => data[key]

export const getPricing = async (modelRef: string): Promise<ModelPricing | null> => {
  const data = await fetchPricing()
  const raw =
    lookup(data, modelRef) ??
    (() => {
      const idx = modelRef.indexOf('/')
      return idx === -1 ? undefined : lookup(data, modelRef.slice(idx + 1))
    })()
  if (!raw) return null
  return {
    input: raw.input_cost_per_token ?? 0,
    output: raw.output_cost_per_token ?? 0,
    cacheRead: raw.cache_read_input_token_cost ?? raw.input_cost_per_token_cache_hit ?? 0,
    cacheCreation: raw.cache_creation_input_token_cost ?? 0,
  }
}
