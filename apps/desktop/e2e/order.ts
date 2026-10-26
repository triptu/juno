import { relative } from 'node:path'
import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter'
import { BROWSER_FIRST, ELECTRON_FIRST, FEEL_FIRST } from './lanes'

const FIRST: Readonly<Record<string, ReadonlyArray<string>>> = { browser: BROWSER_FIRST, feel: FEEL_FIRST, electron: ELECTRON_FIRST }

/**
 * Puts each project's files in its `*_FIRST` list (`lanes.ts`) at the front of
 * its queue, in that order (README, "Order"). Playwright queues test groups in
 * project and suite order after `preprocess`, and has no option for it, so
 * this sorts each project's own entry list. If a Playwright release stops
 * handing out that list, this throws rather than run in the old order.
 */
export default class SlowestFirst implements Reporter {
  async preprocess({ config, suite }: { readonly config: FullConfig; readonly suite: Suite }): Promise<void> {
    for (const project of suite.suites) {
      const first = FIRST[project.project()?.name ?? '']
      if (first === undefined) continue
      const testDir = project.project()!.testDir
      const rank = (file: Suite) => {
        const at = first.indexOf(relative(testDir, file.location?.file ?? ''))
        return at === -1 ? first.length : at
      }
      const entries = project.entries() as Array<Suite>
      entries.sort((a, b) => rank(a) - rank(b))
      if (entries.length > 0 && project.entries()[0] !== entries[0]) throw new Error(`e2e/order.ts: Playwright ${config.version} no longer lets a reporter order a project's files`)
    }
  }

  printsToStdio(): boolean {
    return false
  }
}
