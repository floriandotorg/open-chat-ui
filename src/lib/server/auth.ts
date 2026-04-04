import { db } from '$lib/server/db'
import { getRequestEvent } from '$app/server'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth/minimal'
import { sveltekitCookies } from 'better-auth/svelte-kit'
import { env } from '$env/dynamic/private'

export const auth = betterAuth({
  baseURL: env.ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [sveltekitCookies(getRequestEvent)],
})
