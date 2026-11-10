import { relative, sep } from 'node:path'
import adapter from '@sveltejs/adapter-bun'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({ precompress: true }),
      compilerOptions: {
        runes: ({ filename }) => {
          const relativePath = relative(import.meta.dirname, filename)
          const pathSegments = relativePath.toLowerCase().split(sep)
          const isExternalLibrary = pathSegments.includes('node_modules')

          return isExternalLibrary ? undefined : true
        },
      },
    }),
  ],
  server: {
    // ChatGPT sign-in only redirects to http://127.0.0.1, and "localhost" binds to ::1 alone on macOS.
    host: '127.0.0.1',
    port: 5179,
  },
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'client',
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium', headless: true }],
          },
          include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
          exclude: ['src/lib/server/**'],
        },
      },

      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}', 'browser-host/**/*.{test,spec}.ts'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
})
