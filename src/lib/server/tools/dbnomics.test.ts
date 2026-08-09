import type { ToolContext } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ctx: ToolContext = { userId: 'u1', getApiKey: async () => null, getApiKeys: async () => [] }

const mockFetch = (handler: (url: string) => { status: number; body: string }) => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const { status, body } = handler(url)
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('dbnomics tool', () => {
  afterEach(() => vi.restoreAllMocks())

  it('searches datasets by query', async () => {
    mockFetch(() => ({
      status: 200,
      body: JSON.stringify({
        results: {
          docs: [{ code: 'CPI', name: 'Consumer Price Index', provider_code: 'IMF', provider_name: 'IMF', nb_matching_series: 100, nb_series: 200 }],
          num_found: 1,
        },
      }),
    }))
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({ query: 'consumer prices' }, ctx)
    expect(out).toContain('IMF/CPI')
    expect(out).toContain('100 matching series')
    expect(out).toContain('Found 1 datasets')
  })

  it('lists series in a dataset with a dimensions filter', async () => {
    let capturedUrl = ''
    mockFetch(url => {
      capturedUrl = url
      return {
        status: 200,
        body: JSON.stringify({
          series: {
            num_found: 2,
            docs: [
              {
                provider_code: 'IMF',
                dataset_code: 'CPI',
                series_code: 'A.AE.PCPIA_IX',
                series_name: 'Annual — UAE — CPI',
                period: ['2023', '2024'],
                value: [100, 102.5],
                dimensions: { FREQ: 'A', REF_AREA: 'AE' },
              },
            ],
          },
        }),
      }
    })
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({ dataset_id: 'IMF/CPI', dimensions: '{"REF_AREA":["DE"]}', limit: 5 }, ctx)
    expect(capturedUrl).toContain('/series/IMF/CPI')
    expect(capturedUrl).toContain('observations=0')
    expect(capturedUrl).toContain('dimensions=%7B%22REF_AREA%22%3A%5B%22DE%22%5D%7D')
    expect(out).toContain('IMF/CPI/A.AE.PCPIA_IX')
    expect(out).toContain('2023: 100')
    expect(out).toContain('2024: 102.5')
  })

  it('fetches observations for a series_id', async () => {
    mockFetch(() => ({
      status: 200,
      body: JSON.stringify({
        series: {
          docs: [
            {
              provider_code: 'IMF',
              dataset_code: 'CPI',
              series_code: 'A.AE.PCPIA_IX',
              series_name: 'Annual — UAE',
              period: ['2020', '2021'],
              value: [98, null],
            },
          ],
        },
      }),
    }))
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({ series_id: 'IMF/CPI/A.AE.PCPIA_IX' }, ctx)
    expect(out).toContain('2020: 98')
    expect(out).toContain('2021: NA')
  })

  it('accepts comma-separated series ids', async () => {
    let captured = ''
    mockFetch(url => {
      captured = url
      return { status: 200, body: JSON.stringify({ series: { docs: [] } }) }
    })
    const { dbnomics } = await import('./dbnomics')
    await dbnomics.execute({ series_id: 'IMF/CPI/A.AE.PCPIA_IX,ECB/BSI/M.U2.N.A.A20.A.1.U2.2250.Z01.E' }, ctx)
    expect(captured).toContain('series_ids=IMF%2FCPI%2FA.AE.PCPIA_IX,ECB%2FBSI%2FM.U2.N.A.A20.A.1.U2.2250.Z01.E')
  })

  it('reports an error for an invalid series_id shape', async () => {
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({ series_id: 'IMF' }, ctx)
    expect(out).toContain('Error')
  })

  it('requires at least one actionable parameter', async () => {
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({}, ctx)
    expect(out).toContain('Error')
  })

  it('surfaces API error messages', async () => {
    mockFetch(() => ({ status: 404, body: JSON.stringify({ message: 'Series not found' }) }))
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({ series_id: 'IMF/CPI/NOPE' }, ctx)
    expect(out).toContain('Series not found')
  })

  it('handles no results gracefully', async () => {
    mockFetch(() => ({ status: 200, body: JSON.stringify({ results: { docs: [], num_found: 0 } }) }))
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({ query: 'zzznomatch' }, ctx)
    expect(out).toContain('No datasets found')
  })

  it('truncates long series to the value cap', async () => {
    const periods = Array.from({ length: 6000 }, (_, n) => `P${n}`)
    const values = Array.from({ length: 6000 }, (_, n) => n)
    mockFetch(() => ({
      status: 200,
      body: JSON.stringify({ series: { docs: [{ provider_code: 'IMF', dataset_code: 'CPI', series_code: 'X', series_name: 'Long', period: periods, value: values }] } }),
    }))
    const { dbnomics } = await import('./dbnomics')
    const out = await dbnomics.execute({ series_id: 'IMF/CPI/X' }, ctx)
    expect(out).toContain('P4999: 4999')
    expect(out).not.toContain('P5000:')
  })
})
