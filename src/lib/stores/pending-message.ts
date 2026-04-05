import type { FileAttachment, ImageAttachment } from '$lib/types'

let pendingMessage: string | null = null
let pendingImages: ImageAttachment[] | null = null
let pendingFiles: FileAttachment[] | null = null

export const setPendingMessage = (msg: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
  pendingMessage = msg
  pendingImages = images?.length ? images : null
  pendingFiles = files?.length ? files : null
}

export const consumePendingMessage = () => {
  const msg = pendingMessage
  const imgs = pendingImages
  const fls = pendingFiles
  pendingMessage = null
  pendingImages = null
  pendingFiles = null
  return { message: msg, images: imgs, files: fls }
}
