import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth/minimal'
import * as schema from '../src/lib/server/db/auth.schema'

const [email, password, name] = Bun.argv.slice(2)

if (!email || !password) {
  console.error('Usage: bun scripts/add-user.ts <email> <password> [name]')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) {
  console.error('BETTER_AUTH_SECRET environment variable is required')
  process.exit(1)
}

const db = drizzle({ client: new Database(databaseUrl), schema })

const auth = betterAuth({
  secret,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 1 },
})

await auth.api.signUpEmail({
  body: { email, password, name: name ?? email.split('@')[0] },
})

console.log(`User created: ${email}`)
