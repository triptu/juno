import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/idle.perf.ts', 'test/actions.test.ts', 'test/outbox-idle.test.ts'],
    testNamePattern: /production timing/,
    maxWorkers: 1,
    fileParallelism: false,
    env: { JUNO_PERF: '1' },
  },
})
