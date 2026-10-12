/**
 * The two helpers every atom in Juno is built with (architecture section 7).
 *
 * - `liveQuery(route)` gives a memoized `(payload) => atom` for a stream
 *   route. A `liveQuery` route yields the latest value; a `liveList` route
 *   yields a `ListWindow` kept by `applyListDelta`, with `rowAtom` and
 *   `orderAtom` for per-row subscriptions.
 * - `command(route)` gives a writable atom that runs the command when
 *   written to and exposes the result as an `AsyncResult`.
 *
 * Live query atoms carry a 30 s idle TTL, so a prefetch or a hidden tab keeps
 * its subscription warm across a quick unmount and remount.
 */
import { Effect, Schedule, Stream } from 'effect'
import type { Rpc } from 'effect/rpc'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { liveKindOf, type ListDelta, type LiveValue } from '@juno/contract'
import { EngineClient, registry } from './client'
import { applyListDelta, emptyWindow, type ListWindow } from './list'
import { afterPaint, fromEpochMillis, measure } from './perf'

const IDLE_TTL = '30 seconds'
const RETRY = Schedule.spaced('1 second')

type Payload<R> = Rpc.PayloadConstructor<R>

type ValueOf<R> = R extends Rpc.Rpc<infer _T, infer _P, infer S, infer _E, infer _M, infer _Req>
  ? S extends { readonly Type: Stream.Stream<LiveValue<infer V>, infer _SE> }
    ? V
    : never
  : never

type RowOf<R> = R extends Rpc.Rpc<infer _T, infer _P, infer S, infer _E, infer _M, infer _Req>
  ? S extends { readonly Type: Stream.Stream<ListDelta<infer Row>, infer _SE> }
    ? Row
    : never
  : never

export type LiveValueAtom<V> = Atom.Atom<AsyncResult.AsyncResult<V, unknown>>
export type LiveListAtom<Row> = Atom.Atom<AsyncResult.AsyncResult<ListWindow<Row>, unknown>>

type LiveAtomFor<R> = [RowOf<R>] extends [never] ? LiveValueAtom<ValueOf<R>> : LiveListAtom<RowOf<R>>

/** A stable key for a payload so equal payloads share one atom. */
function payloadKey(payload: unknown): string {
  return JSON.stringify(payload, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  )
}

function liveStream<A>(tag: string, payload: unknown): Stream.Stream<A, unknown, EngineClient> {
  return Stream.unwrap(
    Effect.map(EngineClient, (client) => client(tag as never, payload as never) as unknown as Stream.Stream<A, unknown>),
  ).pipe(Stream.retry(RETRY))
}

function recordUpdate(tag: string, meta: { readonly at: number; readonly seq: number; readonly queryMs: number }): void {
  afterPaint(() => measure('juno.live-update', fromEpochMillis(meta.at), { detail: { route: tag, seq: meta.seq, queryMs: meta.queryMs } }))
}

/** See the module comment. */
export function liveQuery<R extends Rpc.Any>(route: R): (payload: Payload<R>) => LiveAtomFor<R> {
  const tag = route._tag
  const kind = liveKindOf(route)
  if (kind === undefined) throw new Error(`${tag} is not a live query route`)
  const family = Atom.family((key: string) => {
    const payload: unknown = key === 'undefined' ? undefined : JSON.parse(key)
    const atom =
      kind === 'value'
        ? EngineClient.runtime.atom(
            liveStream<LiveValue<unknown>>(tag, payload).pipe(
              Stream.map((message) => {
                recordUpdate(tag, message.meta)
                return message.value
              }),
            ),
          )
        : EngineClient.runtime.atom(
            liveStream<ListDelta<{ readonly id: string; readonly rev: number }>>(tag, payload).pipe(
              Stream.scan(emptyWindow<{ readonly id: string; readonly rev: number }>, (window, delta) => {
                recordUpdate(tag, delta.meta)
                return applyListDelta(window, delta)
              }),
              Stream.drop(1),
            ),
          )
    return atom.pipe(Atom.setIdleTTL(IDLE_TTL))
  })
  return (payload) => family(payload === undefined ? 'undefined' : payloadKey(payload)) as LiveAtomFor<R>
}

/** The ids of a list window, identity-stable while the order does not change. */
export const orderAtom = Atom.family(<Row>(list: LiveListAtom<Row>) =>
  Atom.make((get) => AsyncResult.getOrElse(get(list), () => emptyWindow<Row>()).order).pipe(Atom.withEquality((a, b) => a === b)),
)

/** One row of a list window. Re-renders its subscriber only when that row's `rev` changes. */
export const rowAtom = Atom.family(<Row>(list: LiveListAtom<Row>) =>
  Atom.family((id: string) =>
    Atom.make((get) => AsyncResult.getOrElse(get(list), () => emptyWindow<Row>()).rows.get(id)).pipe(
      Atom.withEquality((a, b) => a === b),
    ),
  ),
)

type SuccessOf<R> = R extends Rpc.Rpc<infer _T, infer _P, infer S, infer _E, infer _M, infer _Req> ? S['Type'] : never
type ErrorOf<R> = R extends Rpc.Rpc<infer _T, infer _P, infer _S, infer E, infer _M, infer _Req> ? E['Type'] : never

export type CommandAtom<R> = Atom.AtomResultFn<Payload<R>, SuccessOf<R>, ErrorOf<R> | unknown>

/** See the module comment. Write the payload to run the command. */
export function command<R extends Rpc.Any>(route: R): CommandAtom<R> {
  const tag = route._tag
  return EngineClient.runtime.fn<Payload<R>>()((payload) =>
    EngineClient.use((client) => client(tag as never, payload as never) as never),
  ) as unknown as CommandAtom<R>
}

const PREFETCH_LIMIT = 3
const warm: Array<{ readonly atom: Atom.Atom<unknown>; readonly release: () => void }> = []

/**
 * Keeps a live query mounted (performance.md 4.2): call on hover, focus or
 * keyboard selection. At most three are kept; the oldest is released first,
 * and its idle TTL then keeps the subscription for another 30 s.
 */
export function prefetch(atom: Atom.Atom<unknown>): void {
  const index = warm.findIndex((entry) => entry.atom === atom)
  if (index >= 0) {
    const [entry] = warm.splice(index, 1)
    warm.push(entry!)
    return
  }
  warm.push({ atom, release: registry.mount(atom) })
  while (warm.length > PREFETCH_LIMIT) warm.shift()!.release()
}
