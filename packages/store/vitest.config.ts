import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // node:sqlite is synchronous; one process keeps the temp directories apart.
    fileParallelism: false,
  },
})
