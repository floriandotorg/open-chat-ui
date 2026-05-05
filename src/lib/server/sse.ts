import { type StreamHub, subscribe } from '$lib/server/stream-hub'

const HEARTBEAT_MS = 15000

export const hubToSSE = (hub: StreamHub, cursor = 0): Response => {
  const encoder = new TextEncoder()
  const heartbeatBytes = encoder.encode(': keepalive\n\n')
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closed = false

  const teardown = () => {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    unsubscribe?.()
    unsubscribe = null
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown, index: number) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`id: ${index}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
          teardown()
        }
      }
      controller.enqueue(heartbeatBytes)
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(heartbeatBytes)
        } catch {
          closed = true
          teardown()
        }
      }, HEARTBEAT_MS)
      unsubscribe = subscribe(hub, {
        cursor,
        onEvent: send,
        onClose: () => {
          if (closed) return
          closed = true
          teardown()
          try {
            controller.close()
          } catch {}
        },
      })
    },
    cancel() {
      closed = true
      teardown()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
