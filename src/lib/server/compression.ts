import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import type { Handle } from '@sveltejs/kit/hooks'

const brotliAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

const MIN_COMPRESSIBLE_BYTES = 1024
const BROTLI_QUALITY = 5
// Streaming endpoints (NDJSON translations, audio, SSE) are excluded by type:
// buffering them would hold back every chunk until the stream ends.
const COMPRESSIBLE_TYPES = ['text/html', 'application/json']

type Encoding = 'br' | 'gzip'

export const pickEncoding = (acceptEncoding: string): Encoding | null => {
  const accepted = new Set(
    acceptEncoding
      .split(',')
      .map(part => part.trim().split(';'))
      .filter(([, quality]) => quality?.trim() !== 'q=0')
      .map(([name]) => name.trim().toLowerCase()),
  )
  if (accepted.has('br')) {
    return 'br'
  }
  if (accepted.has('gzip')) {
    return 'gzip'
  }
  return null
}

const isCompressible = (response: Response) => {
  const type = response.headers.get('content-type') ?? ''
  return !!response.body && !response.headers.has('content-encoding') && COMPRESSIBLE_TYPES.some(prefix => type.startsWith(prefix))
}

const encode = (raw: Uint8Array, encoding: Encoding) => (encoding === 'br' ? brotliAsync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }) : gzipAsync(raw))

export const compressResponse = async (request: Request, response: Response): Promise<Response> => {
  const encoding = pickEncoding(request.headers.get('accept-encoding') ?? '')
  if (!encoding || request.method === 'HEAD' || !isCompressible(response)) {
    return response
  }
  const raw = new Uint8Array(await response.arrayBuffer())
  const headers = new Headers(response.headers)
  headers.append('vary', 'Accept-Encoding')
  if (raw.byteLength < MIN_COMPRESSIBLE_BYTES) {
    return new Response(raw, { status: response.status, statusText: response.statusText, headers })
  }
  headers.set('content-encoding', encoding)
  headers.delete('content-length')
  return new Response(await encode(raw, encoding), { status: response.status, statusText: response.statusText, headers })
}

export const handleCompression: Handle = async ({ event, resolve }) => compressResponse(event.request, await resolve(event))
