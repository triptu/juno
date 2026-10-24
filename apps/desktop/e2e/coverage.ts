import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Under JUNO_COVERAGE=1, clears the last run's coverage, and after the run
 * maps what each spec's launches ran back to source files
 * (scripts/coverage-map.mjs, docs/development.md "Affected tests").
 */
export default function coverage(): (() => void) | undefined {
  if (process.env.JUNO_COVERAGE !== '1') return undefined
  rmSync(resolve(__dirname, '../coverage/raw'), { recursive: true, force: true })
  return () => {
    execFileSync(process.execPath, [resolve(__dirname, '../../../scripts/coverage-map.mjs'), 'reduce'], { stdio: 'inherit' })
  }
}
