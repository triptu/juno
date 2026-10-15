import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/** Direct Playwright runs must use the current source, including after a merge. */
export default function build(): void {
  execFileSync(process.execPath, [resolve(__dirname, '../../../scripts/build-cached.mjs'), 'out', 'pnpm', 'build'], {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
  })
}
