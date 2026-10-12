/**
 * The two helpers every atom in Juno is built with (architecture section 7).
 *
 * - `liveQuery(route)` gives a memoized `(payload) => atom` for a stream
 *   route. A `liveValueRoute` yields the latest value; a `liveListRoute`
 *   yields a `ListWindow` kept by `applyListDelta`, with `rowAtom` and
 *   `orderAtom` for per-row subscriptions.
 * - `command(route)` gives a writable atom that runs the command when
 *   written to and exposes the result as an `AsyncResult`.
 *
 * Both are memoized per route, so two modules asking for the same route get
 * the same atoms: one subscription, one result. Live query atoms carry a 30 s
 * idle TTL, so a prefetch or a hidden tab keeps its subscription warm across
 * a quick unmount and remount.
 *
 * Errors: a route's declared errors reach the atom as typed failures.
 * `RpcClientError` (the transport: a closed port, a reconnect) is retried
 * every second and never shown.
 */
import { Effect, type Exit, Stream } from 'effect'
import type { Rpc } from 'effect/rpc'
import { RpcClientError } from 'effect/rpc/RpcClientError'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import { liveKindOf, type ListDelta, type LiveValue } from '@juno/contract'
import { EngineClient, type Registry } from './client'
import { applyListDelta, emptyWindow, type ListWindow } from './list'
import { afterPaint, fromEpochMillis, measure } from './perf'

const IDLE_TTL = '30 seconds'
const RETRY_DELAY = '1 second'

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

type SuccessOf<R> = R extends Rpc.Rpc<infer _T, infer _P, infer S, infer _E, infer _M, infer _Req> ? S['Type'] : never
export type ErrorOf<R> = R extends Rpc.Rpc<infer _T, infer _P, infer _S, infer E, infer _M, infer _Req> ? E['Type'] : never

export type LiveValueAtom<V, E = never> = Atom.Atom<AsyncResult.AsyncResult<V, E>>
export type LiveListAtom<Row, E = never> = Atom.Atom<AsyncResult.AsyncResult<ListWindow<Row>, E>>

type LiveAtomFor<R> = [RowOf<R>] extends [never] ? LiveValueAtom<ValueOf<R>, ErrorOf<R>> : LiveListAtom<RowOf<R>, ErrorOf<R>>

/** A stable key for a payload so equal payloads share one atom. */
function payloadKey(payload: unknown): string {
  if (payload === undefined) return 'undefined'
  return JSON.stringify(payload, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  )
}

const isRpcClientError = (error: unknown): error is RpcClientError => error instanceof RpcClientError

/** Re-subscribes after a transport failure; a route error passes through. */
function retryTransport<A, E, R>(make: () => Stream.Stream<A, E | RpcClientError, R>): Stream.Stream<A, E, R> {
  return make().pipe(
    Stream.catchIf(isRpcClientError, () => Stream.unwrap(Effect.map(Effect.sleep(RETRY_DELAY), () => retryTransport(make)))),
  ) as Stream.Stream<A, E, R>
}

function liveStream<A, E>(tag: string, payload: unknown): Stream.Stream<A, E, EngineClient> {
  return retryTransport<A, E, EngineClient>(() =>
    Stream.unwrap(Effect.map(EngineClient, (client) => client(tag as never, payload as never) as unknown as Stream.Stream<A, E | RpcClientError>)),
  )
}

function recordUpdate(tag: string, meta: { readonly at: number; readonly seq: number; readonly queryMs: number }): void {
  afterPaint(() => measure('juno.live-update', fromEpochMillis(meta.at), { detail: { route: tag, seq: meta.seq, queryMs: meta.queryMs } }))
}

const liveFamilies = new WeakMap<Rpc.Any, (payload: unknown) => Atom.Atom<unknown>>()

/** See the module comment. */
export function liveQuery<R extends Rpc.Any>(route: R): (payload: Payload<R>) => LiveAtomFor<R> {
  const existing = liveFamilies.get(route)
  if (existing) return existing as (payload: Payload<R>) => LiveAtomFor<R>
  const tag = route._tag
  const kind = liveKindOf(route)
  if (kind === undefined) throw new Error(`${tag} is not a live query route`)
  const family = Atom.family((key: string) => {
    const payload: unknown = key === 'undefined' ? undefined : JSON.parse(key)
    const atom =
      kind === 'value'
        ? EngineClient.runtime.atom(
            liveStream<LiveValue<unknown>, unknown>(tag, payload).pipe(
              Stream.map((message) => {
                recordUpdate(tag, message.meta)
                return message.value
              }),
            ),
          )
        : EngineClient.runtime.atom(
            liveStream<ListDelta<{ readonly id: string; readonly rev: number }>, unknown>(tag, payload).pipe(
              Stream.scan(emptyWindow<{ readonly id: string; readonly rev: number }>, (window, delta) => {
                recordUpdate(tag, delta.meta)
                return applyListDelta(window, delta)
              }),
              Stream.drop(1),
            ),
          )
    return atom.pipe(Atom.setIdleTTL(IDLE_TTL))
  })
  const make = (payload: unknown) => family(payloadKey(payload))
  liveFamilies.set(route, make)
  return make as (payload: Payload<R>) => LiveAtomFor<R>
}

/** The ids of a list window, identity-stable while the order does not change. */
export const orderAtom = Atom.family(<Row, E>(list: LiveListAtom<Row, E>) =>
  Atom.make((get) => AsyncResult.getOrElse(get(list), () => emptyWindow<Row>()).order).pipe(Atom.withEquality((a, b) => a === b)),
)

/** One row of a list window. Re-renders its subscriber only when that row's `rev` changes. */
export const rowAtom = Atom.family(<Row, E>(list: LiveListAtom<Row, E>) =>
  Atom.family((id: string) =>
    Atom.make((get) => AsyncResult.getOrElse(get(list), () => emptyWindow<Row>()).rows.get(id)).pipe(
      Atom.withEquality((a, b) => a === b),
    ),
  ),
)

export type CommandAtom<R> = Atom.AtomResultFn<Payload<R>, SuccessOf<R>, ErrorOf<R> | RpcClientError>

function makeCommandAtom<R extends Rpc.Any>(route: R): CommandAtom<R> {
  const tag = route._tag
  return EngineClient.runtime.fn<Payload<R>>()((payload) =>
    EngineClient.use((client) => client(tag as never, payload as never) as never),
  ) as unknown as CommandAtom<R>
}

const commands = new WeakMap<Rpc.Any, unknown>()

/** See the module comment. Write the payload to run the command. */
export function command<R extends Rpc.Any>(route: R): CommandAtom<R> {
  const existing = commands.get(route)
  if (existing) return existing as CommandAtom<R>
  const atom = makeCommandAtom(route)
  commands.set(route, atom)
  return atom
}

/**
 * Runs a command once and resolves with its `Exit`, for code with no
 * component to mount an atom in (menus, the undo stack). Each call gets its
 * own atom, so concurrent calls do not interrupt each other.
 */
export function runCommand<R extends Rpc.Any>(
  registry: Registry,
  route: R,
  payload: Payload<R>,
): Promise<Exit.Exit<SuccessOf<R>, ErrorOf<R> | RpcClientError>> {
  const atom = makeCommandAtom(route)
  const unmount = registry.mount(atom)
  registry.set(atom, payload)
  return Effect.runPromiseExit(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).finally(unmount)
}

const PREFETCH_LIMIT = 3
const warmByRegistry = new WeakMap<Registry, Array<{ readonly atom: Atom.Atom<unknown>; readonly release: () => void }>>()

/**
 * Keeps a live query mounted (performance.md 4.2): call on hover, focus or
 * keyboard selection. At most three are kept per registry; the oldest is
 * released first, and its idle TTL then keeps the subscription for another
 * 30 s.
 */
export function prefetch(registry: Registry, atom: Atom.Atom<unknown>): void {
  let warm = warmByRegistry.get(registry)
  if (!warm) {
    warm = []
    warmByRegistry.set(registry, warm)
  }
  const index = warm.findIndex((entry) => entry.atom === atom)
  if (index >= 0) {
    const [entry] = warm.splice(index, 1)
    warm.push(entry!)
    return
  }
  warm.push({ atom, release: registry.mount(atom) })
  while (warm.length > PREFETCH_LIMIT) warm.shift()!.release()
}
