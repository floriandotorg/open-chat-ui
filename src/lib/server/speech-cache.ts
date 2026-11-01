import { error } from '@sveltejs/kit'

export const SPEECH_CACHE_TTL_MS = 5 * 60_000

interface SpeechCacheOptions {
  ttlMs?: number
  maxEntries?: number
  maxEntriesPerUser?: number
  maxBytes?: number
  maxEntryBytes?: number
  initialBufferBytes?: number
}

interface CachedSpeech {
  id: string
  userId: string
  chunks: Uint8Array<ArrayBuffer>[]
  size: number
  complete: boolean
  failure?: Error
  reader: ReadableStreamDefaultReader<Uint8Array>
  waiters: Set<() => void>
  timer?: ReturnType<typeof setTimeout>
}

const notify = (entry: CachedSpeech) => {
  for (const wake of entry.waiters) {
    wake()
  }
  entry.waiters.clear()
}

const parseRange = (header: string | null, size: number) => {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) {
    return undefined
  }
  const first = Number(match[1])
  const last = Number(match[2])
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
    return null
  }
  const start = match[1] ? first : Math.max(0, size - last)
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1
  if (start >= size || start > end || (!match[1] && last === 0)) {
    return null
  }
  return { start, end }
}

export const createSpeechCache = (options: SpeechCacheOptions = {}) => {
  const ttlMs = options.ttlMs ?? SPEECH_CACHE_TTL_MS
  const maxEntries = options.maxEntries ?? 64
  const maxEntriesPerUser = options.maxEntriesPerUser ?? 8
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024
  const maxEntryBytes = options.maxEntryBytes ?? 4 * 1024 * 1024
  const initialBufferBytes = options.initialBufferBytes ?? 8_000
  const entries = new Map<string, CachedSpeech>()
  let totalBytes = 0

  const fail = (entry: CachedSpeech, message: string) => {
    entry.failure = new Error(message)
    totalBytes -= entry.size
    entry.size = 0
    entry.chunks = []
    notify(entry)
    void entry.reader.cancel().catch(() => {})
  }

  const remove = (entry: CachedSpeech) => {
    entries.delete(entry.id)
    clearTimeout(entry.timer)
    fail(entry, 'Speech expired. Request the audio again.')
  }

  const oldest = (except?: string, userId?: string) => Array.from(entries.values()).find(entry => entry.id !== except && (userId === undefined || entry.userId === userId))

  const consume = async (entry: CachedSpeech) => {
    try {
      while (!entry.failure) {
        const { done, value } = await entry.reader.read()
        if (entry.failure) {
          return
        }
        if (done) {
          if (entry.size === 0) {
            fail(entry, 'Speech generation failed')
          } else {
            entry.complete = true
            notify(entry)
          }
          return
        }
        if (entry.size + value.byteLength > maxEntryBytes) {
          fail(entry, 'Speech generation exceeded the audio size limit')
          return
        }
        while (totalBytes + value.byteLength > maxBytes) {
          const victim = oldest(entry.id)
          if (!victim) {
            fail(entry, 'Speech cache is full. Please try again.')
            return
          }
          remove(victim)
        }
        entry.chunks.push(new Uint8Array(value))
        entry.size += value.byteLength
        totalBytes += value.byteLength
        notify(entry)
      }
    } catch {
      if (!entry.failure) {
        fail(entry, 'Speech generation failed')
      }
    } finally {
      entry.reader.releaseLock()
    }
  }

  const create = (userId: string, source: ReadableStream<Uint8Array>) => {
    while (Array.from(entries.values()).filter(entry => entry.userId === userId).length >= maxEntriesPerUser || entries.size >= maxEntries) {
      const perUserLimit = Array.from(entries.values()).filter(entry => entry.userId === userId).length >= maxEntriesPerUser
      const victim = oldest(undefined, perUserLimit ? userId : undefined)
      if (!victim) {
        throw error(503, 'Speech cache is full. Please try again.')
      }
      remove(victim)
    }
    const entry: CachedSpeech = { id: crypto.randomUUID(), userId, chunks: [], size: 0, complete: false, reader: source.getReader(), waiters: new Set() }
    entries.set(entry.id, entry)
    entry.timer = setTimeout(() => remove(entry), ttlMs)
    entry.timer.unref?.()
    void consume(entry)
    return entry.id
  }

  const stream = (entry: CachedSpeech, start: number, end: number) => {
    let n = 0
    let offset = 0
    let started = false
    let cancelled = false
    let wake: (() => void) | undefined
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!cancelled) {
          if (entry.failure) {
            controller.error(entry.failure)
            return
          }
          if ((started || entry.complete || entry.size >= initialBufferBytes) && n < entry.chunks.length) {
            started = true
            const chunk = entry.chunks[n]
            ++n
            const chunkStart = offset
            offset += chunk.byteLength
            if (offset <= start) {
              continue
            }
            controller.enqueue(chunk.subarray(Math.max(0, start - chunkStart), Math.min(chunk.byteLength, end - chunkStart)))
            if (offset >= end) {
              controller.close()
            }
            return
          }
          if (entry.complete) {
            controller.close()
            return
          }
          await new Promise<void>(resolve => {
            wake = resolve
            entry.waiters.add(resolve)
          })
          if (wake) {
            entry.waiters.delete(wake)
            wake = undefined
          }
        }
      },
      cancel() {
        cancelled = true
        wake?.()
      },
    })
  }

  const respond = (userId: string, id: string, request: Request) => {
    const entry = entries.get(id)
    if (!entry || entry.userId !== userId) {
      throw error(404, 'Speech expired or not found. Request the audio again.')
    }
    if (entry.failure) {
      throw error(502, entry.failure.message)
    }
    const headers = new Headers({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
      'Accept-Ranges': entry.complete ? 'bytes' : 'none',
      ETag: `"${entry.id}"`,
    })
    const ifRange = request.headers.get('If-Range')
    const range = entry.complete && (!ifRange || ifRange === headers.get('ETag')) && request.method !== 'HEAD' ? parseRange(request.headers.get('Range'), entry.size) : undefined
    if (range === null) {
      headers.set('Content-Range', `bytes */${entry.size}`)
      return new Response(null, { status: 416, headers })
    }
    const start = range?.start ?? 0
    const end = range ? range.end + 1 : entry.complete ? entry.size : Number.POSITIVE_INFINITY
    if (entry.complete) {
      headers.set('Content-Length', String(end - start))
    }
    if (range) {
      headers.set('Content-Range', `bytes ${start}-${end - 1}/${entry.size}`)
    }
    return new Response(request.method === 'HEAD' ? null : stream(entry, start, end), { status: range ? 206 : 200, headers })
  }

  const clear = () => {
    for (const entry of entries.values()) {
      remove(entry)
    }
  }

  return { create, respond, clear }
}

export const speechCache = createSpeechCache()
