import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from '@playwright/test'

// The browser project's renderer (`dist/`, vite.web.config.ts), before any of its tests.
test('build the renderer for the browser', () => {
  test.setTimeout(600_000)
  execFileSync(process.execPath, [resolve(__dirname, '../../../../scripts/build-cached.mjs'), 'dist', 'bun', 'run', 'build:web'], {
    cwd: resolve(__dirname, '../..'),
    stdio: 'inherit',
  })
})
