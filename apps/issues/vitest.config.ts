import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Test runner for the recycle-bin feature (and future suites).
//
//   npm test                  → unit tests (no DB needed)
//   TEST_DATABASE_URL=… npm test  → also runs the deletion-engine integration
//                                   tests against that database.
//
// Integration tests are guarded on TEST_DATABASE_URL so they never touch the
// app's real DATABASE_URL by accident.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'cli'],
  },
})
