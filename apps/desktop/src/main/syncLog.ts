/**
 * The sync notice's Copy log (SPEC section 5, item 5): a block the user can
 * paste to us. The app and macOS versions, the sync phase and its reason, and
 * the last lines of engine.log, which the log writer has already filtered
 * (logging.ts `safeDetails`). Nothing else is added. Copy diagnostics in
 * Settings › About ends with the same kind of lines, also added here in main.
 */
import { release } from 'node:os'
import type { SyncLogInput } from '@juno/contract'
import { lastLines, warningLines } from '../logging'

/** How many engine.log lines the block carries. */
export const SYNC_LOG_LINES = 200

// The web shell's host runs this in Node, which has no `getSystemVersion`, on a Mac too.
export const osVersion = (): string => process.platform === 'darwin' && typeof process.getSystemVersion === 'function' ? `macOS ${process.getSystemVersion()}` : `${process.platform} ${release()}`

export async function syncLogText(version: string, { phase, reason }: SyncLogInput, at = new Date(), folder?: string): Promise<string> {
  const why = reason === undefined ? '' : ` (${[reason.error, reason.method, reason.detail].filter((part) => part !== undefined).join(', ')})`
  const lines = await lastLines('engine', SYNC_LOG_LINES, folder)
  return [
    'Juno sync log',
    `Juno ${version} on ${osVersion()}`,
    `Sync: ${phase}${why}`,
    `At ${at.toISOString()}`,
    '',
    `engine.log, last ${lines.length} lines:`,
    ...(lines.length ? lines : ['  None']),
    '',
  ].join('\n')
}

/** What Copy diagnostics adds in main after About's report: the macOS version and the last 50 warnings and errors of each process. */
export async function diagnosticsLogText(): Promise<string> {
  const logs = await warningLines()
  return [
    osVersion(),
    ...logs.flatMap((log) => ['', `${log.process}: last 50 warnings and errors`, ...(log.lines.length ? log.lines : ['  None'])]),
  ].join('\n')
}
