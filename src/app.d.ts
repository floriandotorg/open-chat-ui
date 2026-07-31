declare global {
  namespace App {
    interface Locals {
      user?: { id: string; email: string; name: string }
      pb: import('pocketbase').default
    }
  }
}

export {}
