import { error } from '@sveltejs/kit'
import type { User } from 'better-auth'

export const requireUser = (user: User | undefined): User => {
  if (!user) {
    throw error(401, 'Not authenticated')
  }
  return user
}
