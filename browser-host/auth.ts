import { createHash, timingSafeEqual } from 'node:crypto'

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export const isTokenHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export const isAuthorized = (request: Request, tokenHash: string): boolean => {
  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  return presented.length > 0 && isTokenHash(tokenHash) && timingSafeEqual(Buffer.from(hashToken(presented), 'hex'), Buffer.from(tokenHash, 'hex'))
}
