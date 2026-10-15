import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests of main-process modules that need no Electron. The app itself is tested end to end (e2e/).
export default defineConfig({
  test: {
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    maxWorkers: 2,
    include: ['test/**/*.test.ts'],
  },
})
