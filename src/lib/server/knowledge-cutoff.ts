interface ModelEntry {
  knowledge?: string
}

let cache: Record<string, ModelEntry> | undefined
let inflight: Promise<Record<string, ModelEntry>> | undefined

const loadModels = async (): Promise<Record<string, ModelEntry>> => {
  if (cache) return cache
  if (inflight) return inflight
  inflight = fetch('https://models.dev/models.json')
    .then(async res => {
      if (!res.ok) throw new Error(`models.dev responded ${res.status}`)
      cache = (await res.json()) as Record<string, ModelEntry>
      inflight = undefined
      return cache
    })
    .catch(err => {
      inflight = undefined
      throw err
    })
  return inflight
}

export const getKnowledgeCutoff = async (modelRef: string): Promise<string | undefined> => {
  const models = await loadModels()
  return models[modelRef]?.knowledge
}
