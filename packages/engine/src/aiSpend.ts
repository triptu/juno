/**
 * The engine's model calls spend inside the agent's daily cap (plan v3 §5.4,
 * SPEC 13.10). `admit` offers a reservation on the AgentHost port
 * (`host.spend.asks`) and waits for the agent's answer from its ledger. With
 * no agent listening, or no answer within `ANSWER_TIMEOUT`, the call is
 * blocked: an engine call never runs outside the cap. A settlement is
 * offered until the agent takes it, also across an agent restart.
 *
 * Amounts cross the port as integer nanodollars, rounded up. A call made
 * under `AiBackground` asks as the backlog, which the ledger stops at three
 * quarters of the engine's half, so new threads and Redraw keep the rest.
 */
import { randomUUID } from 'node:crypto'
import type { Admission } from '@juno/ai'
import type { HostSpendAsk } from '@juno/agent-contract'
import { Context, Deferred, Effect, Layer, Stream, SubscriptionRef } from 'effect'

const NANODOLLARS = 1_000_000_000
/** The agent answers from one local SQLite transaction; this is far above that. */
const ANSWER_TIMEOUT = '10 seconds'

type Answer = { readonly id: string; readonly ask: 'reserve' | 'settle'; readonly result: 'reserved' | 'blocked' | 'settled' }

const nanodollars = (usd: number): number => Math.max(0, Math.ceil(usd * NANODOLLARS))

/** The call is backlog work: art for older topics, Home's checks, the automated channel check. */
export const AiBackground = Context.Reference<boolean>('juno/engine/AiBackground', { defaultValue: () => false })

export class AiSpend extends Context.Service<AiSpend, {
  /** Reserves `upperUsd` in the agent's ledger, or says the call is blocked. */
  readonly admit: (upperUsd: number) => Effect.Effect<Admission>
  /** Counts agent links. A new link wakes the jobs that stopped for want of one. */
  readonly links: Stream.Stream<number>
  /** Counts the agent's word that its ledger may have room again (a higher cap, a raise, a release after a refusal). Each wakes the jobs. */
  readonly rooms: Stream.Stream<number>
  /** The AgentHost side: the open asks, now and on every change, and the agent's answers. */
  readonly host: {
    readonly asks: Stream.Stream<ReadonlyArray<HostSpendAsk>>
    readonly answer: (answer: Answer) => Effect.Effect<void>
    readonly room: Effect.Effect<void>
  }
}>()('juno/engine/AiSpend') {
  static readonly layer = Layer.effect(AiSpend, Effect.gen(function* () {
    const asks = yield* SubscriptionRef.make<ReadonlyArray<HostSpendAsk>>([])
    const links = yield* SubscriptionRef.make(0)
    const rooms = yield* SubscriptionRef.make(0)
    const waiting = new Map<string, Deferred.Deferred<'reserved' | 'blocked'>>()
    let listeners = 0

    const offer = (ask: HostSpendAsk) => SubscriptionRef.update(asks, (open) => [...open, ask])
    const drop = (id: string, tag: HostSpendAsk['_tag']) =>
      SubscriptionRef.update(asks, (open) => open.filter((ask) => ask.id !== id || ask._tag !== tag))
    const settle = (id: string, usd: number | undefined) => offer({ _tag: 'settle', id, actual: usd === undefined ? null : nanodollars(usd) })

    const admit = (upperUsd: number): Effect.Effect<Admission> => Effect.gen(function* () {
      if (listeners === 0) return { _tag: 'Blocked', reason: 'no-agent' } as const
      const id = randomUUID()
      const answer = yield* Deferred.make<'reserved' | 'blocked'>()
      waiting.set(id, answer)
      const background = yield* AiBackground
      yield* offer({ _tag: 'reserve', id, amount: nanodollars(upperUsd), ...(background ? { background } : {}) })
      const result = yield* Deferred.await(answer).pipe(
        Effect.timeoutOption(ANSWER_TIMEOUT),
        // Not answered: stop offering it, and release it in case the agent reserved it after all.
        Effect.onExit((exit) => exit._tag === 'Success' && exit.value._tag === 'Some'
          ? Effect.void
          : drop(id, 'reserve').pipe(Effect.andThen(settle(id, 0)))),
        Effect.ensuring(Effect.sync(() => waiting.delete(id))),
      )
      if (result._tag === 'None') return { _tag: 'Blocked', reason: 'no-answer' } as const
      if (result.value === 'blocked') return { _tag: 'Blocked', reason: 'cap' } as const
      return { _tag: 'Admitted', settle: (usd: number | undefined) => settle(id, usd) } as const
    })

    const hostAsks = Stream.unwrap(Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => { listeners++ }).pipe(Effect.andThen(SubscriptionRef.update(links, (n) => n + 1))),
        () => Effect.sync(() => { listeners-- }),
      )
      // Each change carries every open ask, so only the latest matters: a slow agent never works through stale lists.
      return SubscriptionRef.changes(asks).pipe(Stream.buffer({ capacity: 1, strategy: 'sliding' }))
    }))

    const answer = (answer: Answer): Effect.Effect<void> => Effect.gen(function* () {
      yield* drop(answer.id, answer.ask)
      const waiter = answer.ask === 'reserve' ? waiting.get(answer.id) : undefined
      if (waiter !== undefined) yield* Deferred.succeed(waiter, answer.result === 'reserved' ? 'reserved' : 'blocked')
    })

    const room = SubscriptionRef.update(rooms, (n) => n + 1)

    return AiSpend.of({ admit, links: SubscriptionRef.changes(links), rooms: SubscriptionRef.changes(rooms), host: { asks: hostAsks, answer, room } })
  }))
}
