import { defineEnvVars } from '@sveltejs/kit/env'

export const variables = defineEnvVars({
  ENCRYPTION_SECRET: {},
  ORIGIN: {},
  POCKETBASE_ADMIN_EMAIL: {},
  POCKETBASE_ADMIN_PASSWORD: {},
  POCKETBASE_URL: {},
  PUBLIC_POCKETBASE_URL: { public: true },
  UPLOAD_DIR: { schema: value => value ?? './uploads' },
})
