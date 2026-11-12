import { connectionModelRef, parseOpenAIConnection } from '#lib/model-connection.ts'
import { mapUserSettings } from '#lib/server/db/records.ts'
import { getFirstOrNull, pb } from '#lib/server/pb.ts'

export const getUserOpenAIConnection = async (userId: string) => {
  const settings = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )
  return parseOpenAIConnection(settings?.openaiConnection)
}

export const resolveUserModelRef = async (userId: string, modelRef: string): Promise<string> => {
  if (!modelRef.startsWith('openai/') && !modelRef.startsWith('chatgpt/')) {
    return modelRef
  }
  return connectionModelRef(modelRef, await getUserOpenAIConnection(userId))
}
