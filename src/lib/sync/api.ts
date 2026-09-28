const send = async <T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> => {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string' ? data.message : 'Request failed'
    throw new Error(message)
  }
  // Callers own the response contract of the endpoint they call.
  return data as T
}

export const api = {
  post: <T = unknown>(path: string, body: Record<string, unknown>) => send<T>('POST', path, body),
  patch: <T = unknown>(path: string, body: Record<string, unknown>) => send<T>('PATCH', path, body),
  delete: <T = unknown>(path: string) => send<T>('DELETE', path),
}
