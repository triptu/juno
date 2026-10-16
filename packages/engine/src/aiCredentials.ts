/**
 * The OpenRouter key main sends over `parentPort` (`aiKey`), held in memory
 * only (ADR 0006): on startup, after every engine restart and on every
 * change in Settings › Juno. It is never in `EngineConfig`, a file or a log.
 * A change bumps `revision`; provider calls under way are cancelled and the
 * background jobs start a new pass.
 */
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import { AiSpend } from './aiSpend'
import { HostLink } from './protocol/host'

export class AiCredentials extends Context.Service<AiCredentials, {
  readonly key: Effect.Effect<string | undefined>
  readonly revisions: Stream.Stream<number>
  readonly revision: Effect.Effect<number>
}>()('juno/engine/AiCredentials') {
  static readonly layer = Layer.effect(AiCredentials, Effect.gen(function* () {
    const host = yield* HostLink
    let key: string | undefined
    const revision = yield* SubscriptionRef.make(0)
    const messages = yield* host.messages
    yield* Effect.forkScoped(Stream.runForEach(messages, message => {
      if (message._tag !== 'aiKey') return Effect.void
      const next = message.key?.trim() || undefined
      if (next === key) return Effect.void
      key = next
      return SubscriptionRef.update(revision, value => value + 1)
    }))
    return {
      key: Effect.sync(() => key),
      revision: SubscriptionRef.get(revision),
      revisions: SubscriptionRef.changes(revision),
    }
  }))
}

/**
 * What starts a new pass of a background AI job: a key change, a new link to
 * the agent's spend ledger, or the ledger's word that it may have room again
 * (the owner raised the cap), so a job stopped at the cap does not wait for its timer.
 */
export const aiWakes: Effect.Effect<Stream.Stream<string>, never, AiCredentials | AiSpend> = Effect.gen(function* () {
  const credentials = yield* AiCredentials
  const spend = yield* AiSpend
  return Stream.zipLatest(Stream.zipLatest(credentials.revisions, spend.links), spend.rooms).pipe(
    Stream.map(([[revision, link], room]) => `${revision}.${link}.${room}`),
  )
})
