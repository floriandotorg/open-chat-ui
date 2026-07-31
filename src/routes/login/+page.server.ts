import type { Actions, PageServerLoad } from './$types'
import { fail, redirect } from '@sveltejs/kit'

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
      await event.locals.pb.collection('users').authWithPassword(email, password)
    } catch {
      return fail(400, { message: 'Invalid email or password' })
    }

    throw redirect(302, '/chat')
  },
}
