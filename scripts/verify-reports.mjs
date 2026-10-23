import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** Preserve structured reports before the detached verification checkout disappears. */
export function keepReports(checkout, destination, since) {
  const files = []
  const walk = (directory) => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'coverage', 'traces'].includes(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.json') && statSync(path).mtimeMs >= since) {
        const name = relative(checkout, path)
        if (!/apps\/(desktop|gallery)\/(test-results|playwright-report)\//.test(name)) continue
        const target = join(destination, 'reports', name)
        mkdirSync(dirname(target), { recursive: true })
        cpSync(path, target)
        files.push(target)
      }
    }
  }
  for (const directory of ['.remote', 'apps/desktop/test-results', 'apps/desktop/playwright-report', 'apps/gallery/test-results', 'apps/gallery/playwright-report']) walk(join(checkout, directory))
  return files
}
