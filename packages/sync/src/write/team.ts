import type { Team } from '@juno/slack-schema'
import { StoreWriter } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

export const upsertTeam = (team: Team, selfId: string, prefs: unknown, bootedAt: number | undefined): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const existing = yield* sql<{ booted_at: string | null; prefs_json: string | null }>`SELECT booted_at, prefs_json FROM team WHERE id = ${team.id}`
    const booted = bootedAt === undefined ? (existing[0]?.booted_at ?? null) : String(bootedAt)
    const prefsJson = prefs === undefined ? (existing[0]?.prefs_json ?? null) : JSON.stringify(prefs)
    yield* sql`INSERT INTO team (id, name, domain, self_user_id, enterprise_id, prefs_json, booted_at)
      VALUES (${team.id}, ${team.name}, ${team.domain}, ${selfId}, ${team.enterprise_id ?? null}, ${prefsJson}, ${booted})
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, domain = excluded.domain, self_user_id = excluded.self_user_id,
        enterprise_id = excluded.enterprise_id, prefs_json = excluded.prefs_json, booted_at = excluded.booted_at`
    yield* invalidate(syncKeys.team)
  })

export const setPref = (name: string, value: unknown): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ id: string; prefs_json: string | null }>`SELECT id, prefs_json FROM team`
    const team = rows[0]
    if (team === undefined) return
    const prefs = (team.prefs_json === null ? {} : JSON.parse(team.prefs_json)) as Record<string, unknown>
    prefs[name] = value
    yield* sql`UPDATE team SET prefs_json = ${JSON.stringify(prefs)} WHERE id = ${team.id}`
    yield* invalidate(syncKeys.team)
  })
