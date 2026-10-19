import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['test/**/*.perf.ts', 'test/turn-timing.test.ts'], env: { JUNO_PERF: '1' }, maxWorkers: 1, fileParallelism: false },
})
