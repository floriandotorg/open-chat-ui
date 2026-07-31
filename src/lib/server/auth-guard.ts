import { error } from '@sveltejs/kit'

export type AuthUser = { id: string; email: string; name: string }

export const requireUser = (user: AuthUser | undefined): AuthUser => {
  if (!user) {
    throw error(401, 'Not authenticated')
  }
  return user
}
