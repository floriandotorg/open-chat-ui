import { type StreamHub, subscribe } from '$lib/server/stream-hub'

export const hubToSSE = (hub: StreamHub, cursor = 0): Response => {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown, index: number) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`id: ${index}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
          unsubscribe?.()
        }
      }
      unsubscribe = subscribe(hub, {
        cursor,
        onEvent: send,
        onClose: () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {}
        },
      })
    },
    cancel() {
      closed = true
      unsubscribe?.()
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
