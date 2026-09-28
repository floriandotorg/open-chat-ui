import { error } from '@sveltejs/kit'

// Mirrors the PocketBase id field pattern (pb_schema.json) so client
// generated ids fail fast with a 400 instead of a PocketBase validation error.
const RECORD_ID = /^[a-zA-Z0-9-]{15,36}$/

export const clientRecordId = (requested: string | undefined): string => {
  if (requested === undefined) {
    return crypto.randomUUID()
  }
  if (!RECORD_ID.test(requested)) {
    throw error(400, 'Invalid record id')
  }
  return requested
}
