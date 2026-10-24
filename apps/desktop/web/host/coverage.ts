import { Session } from 'node:inspector'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One host's engine and agent functions, only during a coverage run. */
export function recordHostCoverage(folder: string | undefined): void {
  if (folder === undefined) return
  const session = new Session()
  session.connect()
  session.post('Profiler.enable')
  session.post('Profiler.startPreciseCoverage', { callCount: false, detailed: false })
  let writes = 0
  const flush = () => session.post('Profiler.takePreciseCoverage', (error, coverage) => {
    if (error !== null) throw error
    const ran: Record<string, number[]> = {}
    for (const script of coverage.result) {
      if (!script.url.includes('/dist/host/')) continue
      const starts = script.functions.flatMap(({ ranges }) => {
        const first = ranges[0]
        return first !== undefined && first.count > 0 && first.startOffset > 0 ? [first.startOffset] : []
      })
      if (starts.length > 0) ran[script.url] = starts
    }
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `host-${process.pid}-${writes++}.json`), JSON.stringify(ran))
  })
  process.on('exit', flush)
  setInterval(flush, 2_000).unref()
}
