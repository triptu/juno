/** Workspace read mirroring defaults on; an explicit false keeps marks local. */
import { Effect } from 'effect'
import { MIRROR_READS_PREF, type MirrorSetting } from '@juno/contract'
import { StoreReader, StoreWriter, type SqlError } from '@juno/store'
import type { EngineConfig } from '@juno/contract'

const decide = (stored: string | undefined, _config: EngineConfig): MirrorSetting => {
  const value = stored === undefined ? undefined : (JSON.parse(stored) as unknown)
  return typeof value === 'boolean' ? { on: value, explicit: true } : { on: true, explicit: false }
}

/** The setting, read on the writer inside a command's or the worker's transaction. */
export const mirrorSetting = (config: EngineConfig): Effect.Effect<MirrorSetting, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = ${MIRROR_READS_PREF}`
    return decide(rows[0]?.value_json, config)
  })

/** The setting, read on the reader for the live value. */
export const readMirrorSetting = (config: EngineConfig): Effect.Effect<MirrorSetting, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const sql = yield* StoreReader
    const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = ${MIRROR_READS_PREF}`
    return decide(rows[0]?.value_json, config)
  })
