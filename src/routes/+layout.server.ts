import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async event => ({
  user: event.locals.user ?? null,
})
