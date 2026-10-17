import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

/** Direct Playwright runs must use the current source, including after a merge. */
export default function build(): void {
  execFileSync(process.execPath, [resolve(__dirname, '../../../scripts/build-cached.mjs'), 'out', 'pnpm', 'build'], {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
  })
  // After an install that skipped Electron's download (`pnpm install --offline`), the
  // electron package downloads its binary on first use. Do that once here: two workers
  // doing it at once each unpack into the same folder and leave a broken app.
  createRequire(resolve(__dirname, '../package.json'))('electron')
}
