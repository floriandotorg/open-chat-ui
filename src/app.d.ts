import type { User, Session } from 'better-auth/minimal'

type AdminUser = User & {
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
  banExpires?: Date | null
}

declare global {
  namespace App {
    interface Locals {
      user?: AdminUser
      session?: Session
    }
  }
}
