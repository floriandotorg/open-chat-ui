let pendingMessage: string | null = null

export const setPendingMessage = (msg: string) => {
  pendingMessage = msg
}

export const consumePendingMessage = () => {
  const msg = pendingMessage
  pendingMessage = null
  return msg
}
