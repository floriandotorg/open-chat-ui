import type { ToolDefinition } from './types'

const API_BASE = 'https://api.db.nomics.world/v22'
const TIMEOUT_MS = 30_000
const MAX_VALUES = 5000
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

const fetchJson = async (url: string): Promise<unknown> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) {
    const msg = (() => {
      try {
        return (JSON.parse(text) as { message?: string }).message ?? text
      } catch {
        return text
      }
    })()
    return { __error: `DBnomics HTTP ${res.status}: ${msg.slice(0, 500)}` }
  }
  try {
    return JSON.parse(text)
  } catch {
    return { __error: `DBnomics returned non-JSON response: ${text.slice(0, 300)}` }
  }
}

interface DatasetResult {
  code?: string
  name?: string
  provider_code?: string
  provider_name?: string
  nb_matching_series?: number
  nb_series?: number
  description?: string
}

interface SeriesDoc {
  series_code?: string
  series_name?: string
  dataset_code?: string
  dataset_name?: string
  provider_code?: string
  '@frequency'?: string
  period?: string[]
  value?: (string | number | null)[]
  dimensions?: Record<string, string>
}

const truncatePeriods = (period: string[], value: (string | number | null)[]): { period: string[]; value: (string | number | null)[] } => {
  if (period.length <= MAX_VALUES) return { period, value }
  return {
    period: period.slice(0, MAX_VALUES),
    value: value.slice(0, MAX_VALUES),
  }
}

const formatSearch = (docs: DatasetResult[], numFound: number): string => {
  if (!docs.length) return 'No datasets found.'
  const lines = docs.map((d, n) => {
    const code = `${d.provider_code ?? '?'}/${d.code ?? '?'}`
    const name = d.name ?? 'Untitled'
    const matching = d.nb_matching_series ?? d.nb_series ?? 0
    const desc = d.description ? `\n    ${d.description.slice(0, 200)}` : ''
    return `${n + 1}. ${code} — ${name} (${matching} matching series)${desc}`
  })
  return `Found ${numFound} datasets.\n\n${lines.join('\n')}`
}

const formatSeries = (docs: SeriesDoc[]): string => {
  if (!docs.length) return 'No series found.'
  const lines = docs.map(d => {
    const header = `${d.provider_code ?? '?'}/${d.dataset_code ?? '?'}/${d.series_code ?? '?'}`
    const name = d.series_name ?? '(unnamed)'
    const dims = d.dimensions
      ? ` | ${Object.entries(d.dimensions)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`
      : ''
    let body = ''
    if (d.period && d.value) {
      const { period, value } = truncatePeriods(d.period, d.value)
      const rows = period.map((p, i) => `${p}: ${value[i] ?? 'NA'}`).join('; ')
      body = `\n    Data: ${rows}`
    }
    return `• ${header} — ${name}${dims}${body}`
  })
  return lines.join('\n')
}

const searchDatasets = async (query: string, limit: number): Promise<string> => {
  const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}`
  const data = (await fetchJson(url)) as { __error?: string; results?: { docs?: DatasetResult[]; num_found?: number } }
  if (data.__error) return data.__error
  const docs = data.results?.docs ?? []
  return formatSearch(docs, data.results?.num_found ?? 0)
}

const listSeries = async (datasetId: string, query: string, dimensions: string, limit: number): Promise<string> => {
  const [providerCode, datasetCode] = datasetId.split('/')
  if (!providerCode || !datasetCode) return 'Error: dataset_id must be "PROVIDER/DATASET" (e.g. "IMF/CPI").'
  const params = new URLSearchParams({ limit: String(limit), observations: '0', metadata: '0' })
  if (query) params.set('q', query)
  if (dimensions) params.set('dimensions', dimensions)
  const url = `${API_BASE}/series/${encodeURIComponent(providerCode)}/${encodeURIComponent(datasetCode)}?${params}`
  const data = (await fetchJson(url)) as { __error?: string; series?: { docs?: SeriesDoc[]; num_found?: number } }
  if (data.__error) return data.__error
  const docs = data.series?.docs ?? []
  return `${formatSeries(docs)}\n\n(${data.series?.num_found ?? 0} total in dataset)`
}

const getSeries = async (seriesIds: string[]): Promise<string> => {
  const ids: string[] = []
  for (const s of seriesIds) {
    const parts = s.split('/')
    if (parts.length < 3) return 'Error: each series_id must be "PROVIDER/DATASET/SERIES" (e.g. "IMF/CPI/A.AE.PCPIA_IX").'
    const seriesCode = parts.slice(2).join('/')
    ids.push(`${parts[0]}/${parts[1]}/${seriesCode}`)
  }
  const url = `${API_BASE}/series?series_ids=${ids.map(encodeURIComponent).join(',')}&observations=1&metadata=0&format=json`
  const data = (await fetchJson(url)) as { __error?: string; series?: { docs?: SeriesDoc[]; num_found?: number } }
  if (data.__error) return data.__error
  return formatSeries(data.series?.docs ?? [])
}

export const dbnomics: ToolDefinition = {
  name: 'dbnomics',
  description:
    "Query DBnomics, the world's economic database aggregating statistical time series from hundreds of providers (IMF, World Bank, ECB, OECD, Eurostat, national stat offices). Three modes: (1) dataset search — find datasets by keyword; (2) series listing — enumerate series in a dataset, optionally filtered; (3) series fetch — download actual observations (periods + values). Prefer searching datasets first, then listing series to find a code, then fetching the data.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Full-text search term. With dataset_id present it filters series within that dataset; without dataset_id it searches datasets (mode 1).',
      },
      dataset_id: {
        type: 'string',
        description: 'A dataset identifier "PROVIDER/DATASET" (e.g. "IMF/CPI"). When set without series_id, lists series in the dataset (mode 2).',
      },
      series_id: {
        type: 'string',
        description: 'Comma-separated series identifiers "PROVIDER/DATASET/SERIES" (e.g. "IMF/CPI/A.AE.PCPIA_IX"). Fetches observations (mode 3).',
      },
      dimensions: {
        type: 'string',
        description: 'JSON object filtering series by dimension codes, e.g. {"REF_AREA":["DE"],"FREQ":["A"]}. Used with dataset_id (mode 2).',
      },
      limit: {
        type: 'integer',
        description: `Number of results to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
      },
    },
  },
  execute: async args => {
    const seriesId = String(args.series_id ?? '').trim()
    const datasetId = String(args.dataset_id ?? '').trim()
    const query = String(args.query ?? '').trim()
    const dimensions = String(args.dimensions ?? '').trim()
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor((args.limit as number) ?? DEFAULT_LIMIT)))

    if (seriesId)
      return getSeries(
        seriesId
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      )
    if (datasetId) return listSeries(datasetId, query, dimensions, limit)
    if (query) return searchDatasets(query, limit)
    return 'Error: provide query (search datasets), dataset_id (list series), or series_id (fetch observations).'
  },
}
