export type ChatGPTTokenSource = (rejectedToken?: string) => Promise<string | null>

export const CHATGPT_RECONNECT_MESSAGE = 'Connect your ChatGPT subscription again in Settings > Connections to continue. Your browser host token and website passwords do not need to change.'
export const CHATGPT_REFRESH_UNAVAILABLE = 'ChatGPT could not renew the connection right now. Try again in a moment; you do not need to change your browser host token or website passwords.'

export const resolveChatGPTToken = async (source: ChatGPTTokenSource, rejectedToken?: string): Promise<string> => {
  let token: string | null
  try {
    token = await (rejectedToken === undefined ? source() : source(rejectedToken))
  } catch {
    throw new Error(CHATGPT_REFRESH_UNAVAILABLE)
  }
  if (!token) {
    throw new Error(CHATGPT_RECONNECT_MESSAGE)
  }
  return token
}
