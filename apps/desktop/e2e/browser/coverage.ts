import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

/** Match the compact function-offset format used by Electron's coverage recorder. */
export async function recordPageCoverage(page: Page, folder: string | undefined): Promise<() => Promise<void>> {
  if (folder === undefined) return async () => {}
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
  return async () => {
    const scripts = await page.coverage.stopJSCoverage()
    const ran: Record<string, number[]> = {}
    for (const script of scripts) {
      const starts = script.functions.flatMap(({ ranges }) => {
        const first = ranges[0]
        return first !== undefined && first.count > 0 && first.startOffset > 0 ? [first.startOffset] : []
      })
      if (starts.length > 0) ran[script.url] = starts
    }
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'renderer.json'), JSON.stringify(ran))
  }
}
