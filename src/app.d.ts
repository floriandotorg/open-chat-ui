import type { Session, User } from 'better-auth'

declare global {
  namespace App {
    interface Locals {
      user?: User
      session?: Session
    }
  }
}
