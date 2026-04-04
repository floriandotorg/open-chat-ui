import { env } from '$env/dynamic/private'

let cachedKey: CryptoKey | undefined

const getEncryptionKey = async (): Promise<CryptoKey> => {
  if (cachedKey) return cachedKey

  const secret = env.ENCRYPTION_SECRET
  if (!secret) throw new Error('ENCRYPTION_SECRET is not set')

  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'])

  cachedKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode('open-chat-ui'), iterations: 100_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

  return cachedKey
}

export const encrypt = async (plaintext: string): Promise<{ encrypted: string; iv: string }> => {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  return {
    encrypted: Buffer.from(ciphertext).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
  }
}

export const decrypt = async (encrypted: string, iv: string): Promise<string> => {
  const key = await getEncryptionKey()
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'))
  return new TextDecoder().decode(plaintext)
}
