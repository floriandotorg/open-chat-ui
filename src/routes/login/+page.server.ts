import { auth } from '$lib/server/auth'
import type { Actions, PageServerLoad } from './$types'
import { fail, redirect } from '@sveltejs/kit'
import { APIError } from 'better-auth/api'

export const load: PageServerLoad = async event => {
  if (event.locals.user) {
    throw redirect(302, '/chat')
  }
  return {}
}

export const actions: Actions = {
  signInEmail: async event => {
    const formData = await event.request.formData()
    const email = formData.get('email')?.toString() ?? ''
    const password = formData.get('password')?.toString() ?? ''

    try {
      await auth.api.signInEmail({
        body: { email, password },
      })
    } catch (error) {
      if (error instanceof APIError) {
        return fail(400, { message: error.message || 'Sign in failed' })
      }
      return fail(500, { message: 'Unexpected error' })
    }

    throw redirect(302, '/chat')
  },
}
