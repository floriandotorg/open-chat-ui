import * as schema from './schema'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { env } from '$env/dynamic/private'

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

export const db = drizzle({ client: new Database(env.DATABASE_URL), schema })
