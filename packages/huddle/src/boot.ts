/**
 * At boot, the stored leaves of every workspace on this Mac, not only the
 * one signed in: the page may still hold media for a workspace the user
 * left before the engine restarted, and no join may overlap it. Joins wait
 * until every list is read. A list that cannot be read is tried again, and
 * holds joins back meanwhile; its leaves go out when its workspace's session
 * is next attached.
 */
import { Effect, Result } from 'effect'
import { step, type Core } from './core'
import type { HuddleStoreError } from './Huddle'
import * as L from './lifecycle'

export interface BootStores {
  /** The workspaces with a store on this Mac. */
  readonly workspaces: Effect.Effect<ReadonlyArray<string>, HuddleStoreError>
  readonly read: (workspace: string) => Effect.Effect<ReadonlyArray<L.Stored>, HuddleStoreError>
}

/** Runs `read` until it succeeds, waiting longer after each failure. */
const untilRead = <A>(read: Effect.Effect<A, HuddleStoreError>, what: string) =>
  Effect.gen(function* () {
    let pause = 1_000
    while (true) {
      const result = yield* Effect.result(read)
      if (Result.isSuccess(result)) return result.success
      yield* Effect.logWarning(`huddle: ${what} could not be read; joins wait`, { cause: result.failure.cause })
      yield* Effect.sleep(pause)
      pause = Math.min(pause * 2, 30_000)
    }
  })

export const boot = (core: Core, stores: BootStores) =>
  Effect.gen(function* () {
    const workspaces = yield* untilRead(stores.workspaces, 'the workspaces')
    yield* step(core, Effect.sync(() => {
      core.booting = new Set(workspaces)
    }))
    yield* Effect.forEach(workspaces, (workspace) =>
      untilRead(stores.read(workspace), 'the stored leaves').pipe(Effect.flatMap((stored) => step(core, Effect.sync(() => {
        core.s = L.merge(core.s, stored, workspace)
        core.booting = new Set([...(core.booting ?? [])].filter((other) => other !== workspace))
      })))), { concurrency: 'unbounded', discard: true })
  })
