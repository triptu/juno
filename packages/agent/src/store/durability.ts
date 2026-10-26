export interface DurabilityOptions {
  /** Flush the drive cache on macOS. Defaults to ON outside the test preload. */
  readonly fullfsync?: boolean
}

/** Shared by the agent store and pi journal, before either writes. */
export function durablePragmas({ fullfsync = process.env.JUNO_TEST_FULLFSYNC !== '0' }: DurabilityOptions = {}): ReadonlyArray<string> {
  const flush = fullfsync ? 'ON' : 'OFF'
  return [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = FULL',
    `PRAGMA fullfsync = ${flush}`,
    `PRAGMA checkpoint_fullfsync = ${flush}`,
  ]
}
