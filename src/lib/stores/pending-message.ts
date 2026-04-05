import type { ImageAttachment } from '$lib/types'

let pendingMessage: string | null = null
let pendingImages: ImageAttachment[] | null = null

export const setPendingMessage = (msg: string, images?: ImageAttachment[]) => {
  pendingMessage = msg
  pendingImages = images?.length ? images : null
}

export const consumePendingMessage = () => {
  const msg = pendingMessage
  const imgs = pendingImages
  pendingMessage = null
  pendingImages = null
  return { message: msg, images: imgs }
}
