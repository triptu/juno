import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from '@playwright/test'

// The read-only demo (`web/demo/dist/`, `build:demo`): its snapshot from the engine and its build, before its test.
test('export and build the demo', () => {
  // Slow: exports the snapshot and builds the renderer once per run, before the test.
  test.setTimeout(600_000)
  execFileSync(process.execPath, [resolve(__dirname, '../../../../scripts/build-cached.mjs'), 'web/demo/dist', 'bun', 'run', 'build:demo'], {
    cwd: resolve(__dirname, '../..'),
    stdio: 'inherit',
  })
})
