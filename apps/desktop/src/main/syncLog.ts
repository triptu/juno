/**
 * The sync notice's Copy log (SPEC section 5, item 5): a block the user can
 * paste to us. The app and macOS versions, the sync phase and its reason, and
 * the last lines of engine.log, which the log writer has already filtered
 * (logging.ts `safeDetails`). Nothing else is added.
 */
import { release } from 'node:os'
import type { SyncLogInput } from '@juno/contract'
import { lastLines } from '../logging'

/** How many engine.log lines the block carries. */
export const SYNC_LOG_LINES = 200

export const osVersion = (): string => process.platform === 'darwin' ? `macOS ${process.getSystemVersion()}` : `${process.platform} ${release()}`

export async function syncLogText(version: string, { phase, reason }: SyncLogInput, at = new Date()): Promise<string> {
  const why = reason === undefined ? '' : ` (${[reason.error, reason.method, reason.detail].filter((part) => part !== undefined).join(', ')})`
  const lines = await lastLines('engine', SYNC_LOG_LINES)
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
