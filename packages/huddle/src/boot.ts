/**
 * At boot, the stored leaves of every workspace on this Mac, not only the
 * one signed in: the page may still hold media for a workspace the user
 * left before the engine restarted, and no join may overlap it. Joins wait
 * until every list is read. A workspace whose list cannot be read is
 * logged and left out: nothing could ever clear it, and it must not block
 * every join. The signed-in workspace's list is read again when its session
 * is attached, and that read blocks joins until it succeeds (`attach.ts`).
 * Its leaves go out when its workspace's session is next attached.
 */
import { Effect, Result } from 'effect'
import { step, type Core } from './core'
import { failureOf } from './failure'
import type { HuddleStoreError } from './Huddle'
import * as L from './lifecycle'

export interface BootStores {
  /** The workspaces with a store on this Mac. */
  readonly workspaces: Effect.Effect<ReadonlyArray<string>, HuddleStoreError>
  readonly read: (workspace: string) => Effect.Effect<ReadonlyArray<L.Stored>, HuddleStoreError>
}

/** Lists the workspaces until that succeeds, waiting longer after each failure. */
const listed = (stores: BootStores) =>
  Effect.gen(function* () {
    let pause = 1_000
    while (true) {
      const result = yield* Effect.result(stores.workspaces)
      if (Result.isSuccess(result)) return result.success
      yield* Effect.logWarning('huddle: the workspaces could not be listed; joins wait', { error: failureOf(result.failure) })
      yield* Effect.sleep(pause)
      pause = Math.min(pause * 2, 30_000)
    }
  })

export const boot = (core: Core, stores: BootStores) =>
  Effect.gen(function* () {
    const workspaces = yield* listed(stores)
    yield* step(core, Effect.sync(() => {
      core.booting = new Set(workspaces)
    }))
    yield* Effect.forEach(workspaces, (workspace) =>
      Effect.result(stores.read(workspace)).pipe(Effect.flatMap((read) => step(core, Effect.gen(function* () {
        if (Result.isSuccess(read)) core.s = L.merge(core.s, read.success, workspace)
        else yield* Effect.logWarning('huddle: a workspace’s stored leaves could not be read; left out', { workspace, error: failureOf(read.failure) })
        core.booting = new Set([...(core.booting ?? [])].filter((other) => other !== workspace))
      })))), { concurrency: 'unbounded', discard: true })
  })
