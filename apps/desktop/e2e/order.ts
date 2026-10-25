import { relative } from 'node:path'
import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter'
import { ELECTRON_FIRST } from './lanes'

/**
 * Puts the electron project's files in `ELECTRON_FIRST` at the front of its
 * queue, in that order (README, "Electron lane"). Playwright queues test
 * groups in suite order after `preprocess`, and has no option for it, so
 * this sorts the project's own entry list. If a Playwright release stops
 * handing out that list, this throws rather than run in the old order.
 */
export default class SlowestFirst implements Reporter {
  async preprocess({ config, suite }: { readonly config: FullConfig; readonly suite: Suite }): Promise<void> {
    const project = suite.suites.find((each) => each.project()?.name === 'electron')
    if (project === undefined) return
    const testDir = project.project()!.testDir
    const rank = (file: Suite) => {
      const at = ELECTRON_FIRST.indexOf(relative(testDir, file.location?.file ?? ''))
      return at === -1 ? ELECTRON_FIRST.length : at
    }
    const entries = project.entries() as Array<Suite>
    entries.sort((a, b) => rank(a) - rank(b))
    const first = project.entries()[0]
    if (entries.length > 0 && first !== entries[0]) throw new Error(`e2e/order.ts: Playwright ${config.version} no longer lets a reporter order the electron project's files`)
  }

  printsToStdio(): boolean {
    return false
  }
}
