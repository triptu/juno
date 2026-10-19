import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['test/pi.test.ts'], testNamePattern: /when the task timeout passes/, maxWorkers: 1, env: { JUNO_PERF: '1' } },
})
