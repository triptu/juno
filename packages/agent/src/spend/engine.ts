/**
 * The engine's model calls spend inside the same daily cap (plan v3 §5.4),
 * on the `engine` path. The host offers its open asks until each is answered;
 * a reservation is made once by the ask's id, and only the first settlement
 * counts, so an ask offered again is harmless. When the ledger may have
 * room again (a higher cap, a raise, a release after a refusal) it tells the
 * host, so the engine's jobs stopped at the cap do not wait for their timer.
 * A lost port is followed again after a second, for as long as the agent runs.
 */
import { Effect, Queue, Stream } from 'effect'
import { AgentHost } from '../host/client'
import type { SpendLedger } from './index'

/** The ledger's word that it may have room again, told to the host so the engine's jobs stopped at the cap try at once. */
const tellRoom = (spend: SpendLedger): Effect.Effect<never, never, AgentHost> => Effect.gen(function* () {
  const client = yield* AgentHost
  yield* Stream.callback<void>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => spend.onRoom(() => void Queue.offerUnsafe(queue, undefined))),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  ).pipe(
    // Several changes at once need one word.
    Stream.buffer({ capacity: 1, strategy: 'sliding' }),
    Stream.runForEach(() => client['host.spend.room']()),
  )
}).pipe(Effect.ignore, Effect.andThen(Effect.sleep('1 second')), Effect.forever)

const answerAsks = (spend: SpendLedger): Effect.Effect<never, never, AgentHost> => Effect.gen(function* () {
  const client = yield* AgentHost
  yield* client['host.spend.asks']().pipe(
    // Each list holds every open ask, so only the latest one needs answers.
    Stream.buffer({ capacity: 1, strategy: 'sliding' }),
    Stream.runForEach((asks) => Effect.forEach(asks, (ask) => {
      if (ask._tag === 'settle') {
        spend.settle(ask.id, ask.actual ?? undefined)
        return client['host.spend.answer']({ id: ask.id, ask: 'settle', result: 'settled' })
      }
      const reservation = spend.reserve('engine', ask.amount, ask.id, ask.background === true)
      return client['host.spend.answer']({ id: ask.id, ask: 'reserve', result: reservation.kind === 'reserved' ? 'reserved' : 'blocked' })
    }, { discard: true })),
  )
}).pipe(Effect.ignore, Effect.andThen(Effect.sleep('1 second')), Effect.forever)

export const answerEngineSpend = (spend: SpendLedger): Effect.Effect<void, never, AgentHost> =>
  Effect.all([answerAsks(spend), tellRoom(spend)], { concurrency: 2, discard: true })
