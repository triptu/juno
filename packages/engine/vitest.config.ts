import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Engine tests boot a whole engine against an in-process fake Slack. On a
    // loaded machine the first boot pays module transform time too, so the
    // default 5 s is too tight. A real hang still fails well within this.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
