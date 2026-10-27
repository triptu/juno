export interface DurabilityOptions {
  /** Flush the drive cache on macOS. Defaults to ON. */
  readonly fullfsync?: boolean
}

/** Shared by the agent store and pi journal, before either writes. */
export function durablePragmas({ fullfsync = true }: DurabilityOptions = {}): ReadonlyArray<string> {
  const flush = fullfsync ? 'ON' : 'OFF'
  return [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = FULL',
    `PRAGMA fullfsync = ${flush}`,
    `PRAGMA checkpoint_fullfsync = ${flush}`,
  ]
}
