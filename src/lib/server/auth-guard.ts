import { error } from '@sveltejs/kit'

type AppUser = App.Locals['user']
type DefinedUser = NonNullable<AppUser>

export const requireUser = (user: AppUser): DefinedUser => {
  if (!user) {
    throw error(401, 'Not authenticated')
  }
  return user
}

export const requireAdmin = (user: AppUser): DefinedUser => {
  const u = requireUser(user)
  if (u.role !== 'admin') {
    throw error(403, 'Admin access required')
  }
  return u
}
