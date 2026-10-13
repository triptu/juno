/**
 * The mirror setting (owner decision 10-13, M4 plan question 4): whether
 * read marks reach Slack. It is the workspace preference `reads.mirror`.
 * Unset, it is on against the fake Slack (`EngineConfig.fakeSlackUrl`) and
 * off against a real workspace, so marks stay in Juno until the owner turns
 * it on.
 */
import { Effect } from 'effect'
import { MIRROR_READS_PREF, type MirrorSetting } from '@juno/contract'
import { StoreReader, StoreWriter, type SqlError } from '@juno/store'
import type { EngineConfig } from '@juno/contract'

const decide = (stored: string | undefined, config: EngineConfig): MirrorSetting => {
  const value = stored === undefined ? undefined : (JSON.parse(stored) as unknown)
  return typeof value === 'boolean' ? { on: value, explicit: true } : { on: config.fakeSlackUrl !== undefined, explicit: false }
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
