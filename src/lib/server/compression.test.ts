import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { compressResponse, pickEncoding } from './compression'
import { describe, expect, it } from 'vitest'

const bigHtml = `<html>${'<p class="message">hello world</p>'.repeat(200)}</html>`

const run = (response: Response, acceptEncoding = 'gzip, deflate, br') => compressResponse(new Request('http://localhost/chat', { headers: { 'accept-encoding': acceptEncoding } }), response)

describe('pickEncoding', () => {
  it('prefers brotli, falls back to gzip, and honours q=0', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br')
    expect(pickEncoding('gzip;q=1.0, br;q=0')).toBe('gzip')
    expect(pickEncoding('identity')).toBeNull()
    expect(pickEncoding('')).toBeNull()
  })
})

describe('compressResponse', () => {
  it('brotli encodes large HTML and keeps cookies and status', async () => {
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' })
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'b=2; Path=/')

    const response = await run(new Response(bigHtml, { status: 200, headers }))

    expect(response.headers.get('content-encoding')).toBe('br')
    expect(response.headers.get('vary')).toContain('Accept-Encoding')
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(bigHtml)
  })

  it('gzip encodes JSON for clients without brotli', async () => {
    const body = JSON.stringify({ messages: Array.from({ length: 100 }, (_, n) => ({ n, content: 'some text' })) })

    const response = await run(new Response(body, { status: 201, headers: { 'content-type': 'application/json' } }), 'gzip')

    expect(response.status).toBe(201)
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(body)
  })

  it('leaves streams, tiny bodies and pre-encoded responses untouched', async () => {
    const stream = new Response(bigHtml, { headers: { 'content-type': 'application/x-ndjson' } })
    const tiny = await run(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))
    const encoded = new Response(bigHtml, { headers: { 'content-type': 'text/html', 'content-encoding': 'br' } })

    expect(await run(stream)).toBe(stream)
    expect(tiny.headers.get('content-encoding')).toBeNull()
    expect(await tiny.text()).toBe('{"ok":true}')
    expect(await run(encoded)).toBe(encoded)
  })
})
