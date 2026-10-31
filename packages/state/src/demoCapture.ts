/**
 * The exporter's side of the demo snapshot (`@juno/state/demo`): a typed
 * client of the real engine that keeps each answer it reads, encoded by
 * the route's schema, under the key the demo protocol looks it up by.
 * Decoding the engine's answer and encoding it again checks it against the
 * route on the way.
 *
 * Runs in Node, never in the page. A list is read once, from the reset
 * that opens a fresh subscription, so it carries its whole window and refs.
 */
import { Effect, Exit, Layer, Option, Schema, Scope, Stream } from 'effect'
import { RpcClient, RpcSchema, type Rpc } from 'effect/rpc'
import { AllRoutes, type ListDelta, type LiveValue } from '@juno/contract'
import { DEMO_SNAPSHOT_VERSION, demoKey, demoListKey, demoReplyPayload, type DemoList, type DemoSnapshot } from './demo'
import type { EngineProtocol } from './transport'

type Payload<R> = Rpc.PayloadConstructor<R>
type Element<R> = R extends Rpc.Rpc<infer _T, infer _P, infer S, infer _E, infer _M, infer _Req> ? (S['Type'] extends Stream.Stream<infer A, infer _SE> ? A : never) : never
type Success<R> = R extends Rpc.Rpc<infer _T, infer _P, infer S, infer _E, infer _M, infer _Req> ? S['Type'] : never

export interface DemoRecorder {
  /** Reads a live value now and keeps it. */
  readonly value: <R extends Rpc.Any>(route: R, payload: Payload<R>) => Promise<Element<R> extends LiveValue<infer V> ? V : never>
  /** Waits until a live value is `ready`, keeping nothing. Fails after `timeoutMs`. */
  readonly until: <R extends Rpc.Any>(route: R, payload: Payload<R>, ready: (value: Element<R> extends LiveValue<infer V> ? V : never) => boolean, timeoutMs: number) => Promise<void>
  /** Reads a whole live list now (its range should cover every row) and keeps it. */
  readonly list: <R extends Rpc.Any>(route: R, payload: Payload<R>) => Promise<Element<R> extends ListDelta<infer Row> ? ReadonlyArray<Row> : never>
  /** Sends a one-shot request and keeps its answer. */
  readonly reply: <R extends Rpc.Any>(route: R, payload: Payload<R>) => Promise<Success<R>>
  /** Everything kept so far. */
  readonly snapshot: (commit: string, capturedAt: number) => DemoSnapshot
  readonly close: () => Promise<void>
}

const json = <S extends Schema.Top>(schema: S) => Schema.toCodecJson(schema as unknown as Schema.Codec<unknown, unknown>)

function routeOf(tag: string): Rpc.AnyWithProps {
  const rpc = AllRoutes.requests.get(tag) as Rpc.AnyWithProps | undefined
  if (rpc === undefined) throw new Error(`demo export: no route ${tag}`)
  return rpc
}

function streamElement(rpc: Rpc.AnyWithProps): Schema.Top {
  if (!RpcSchema.isStreamSchema(rpc.successSchema)) throw new Error(`demo export: ${rpc._tag} is not a stream`)
  return rpc.successSchema.success
}

/** A recorder over `protocol`, a client protocol to the running engine. */
export async function makeDemoRecorder(protocol: EngineProtocol): Promise<DemoRecorder> {
  const scope = Scope.makeUnsafe()
  const client = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(protocol)
      return yield* RpcClient.make(AllRoutes, { flatten: true }).pipe(Effect.provideContext(context))
    }).pipe(Scope.provide(scope)),
  )
  const call = client as unknown as (tag: string, payload: unknown) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>
  const values: Record<string, unknown> = {}
  const lists: Record<string, DemoList> = {}
  const replies: Record<string, unknown> = {}

  const first = async (tag: string, payload: unknown): Promise<unknown> => {
    const head = await Effect.runPromise(Stream.runHead(call(tag, payload) as Stream.Stream<unknown, unknown>))
    if (Option.isNone(head)) throw new Error(`demo export: ${tag} ended before its first message`)
    return head.value
  }

  return {
    value: async (route, payload) => {
      const rpc = routeOf(route._tag)
      const message = await first(route._tag, payload)
      const encoded = Schema.encodeSync(json(streamElement(rpc)))(message) as { readonly value: unknown }
      values[demoKey(route._tag, Schema.encodeSync(json(rpc.payloadSchema))(payload))] = encoded.value
      return (message as { readonly value: never }).value
    },
    until: async (route, payload, ready, timeoutMs) => {
      const found = await Effect.runPromise(
        Stream.runHead(Stream.filter(call(route._tag, payload) as Stream.Stream<{ readonly value: never }, unknown>, (message) => ready(message.value))).pipe(Effect.timeoutOption(timeoutMs)),
      )
      if (Option.isNone(found) || Option.isNone(found.value)) throw new Error(`demo export: ${route._tag} was not ready within ${timeoutMs} ms`)
    },
    list: async (route, payload) => {
      const rpc = routeOf(route._tag)
      const delta = (await first(route._tag, payload)) as ListDelta<{ readonly id: string }>
      if (!delta.reset) throw new Error(`demo export: ${route._tag} opened without a reset`)
      const encoded = Schema.encodeSync(json(streamElement(rpc)))(delta) as { readonly upsert: ReadonlyArray<{ readonly id: string }>; readonly refs?: unknown; readonly meta: Record<string, unknown> }
      const { seq: _seq, queryMs: _queryMs, encodeMs: _encodeMs, at: _at, own: _own, ...meta } = encoded.meta
      lists[demoListKey(route._tag, Schema.encodeSync(json(rpc.payloadSchema))(payload))] = {
        order: delta.order,
        rows: Object.fromEntries(encoded.upsert.map((row) => [row.id, row])),
        ...(encoded.refs === undefined ? {} : { refs: encoded.refs }),
        meta,
      }
      return delta.upsert as never
    },
    reply: async (route, payload) => {
      const rpc = routeOf(route._tag)
      const success = await Effect.runPromise(call(route._tag, payload) as Effect.Effect<unknown, unknown>)
      const key = demoKey(route._tag, demoReplyPayload(route._tag, Schema.encodeSync(json(rpc.payloadSchema))(payload)))
      replies[key] = Schema.encodeSync(json(rpc.successSchema))(success)
      return success as never
    },
    snapshot: (commit, capturedAt) => ({ version: DEMO_SNAPSHOT_VERSION, commit, capturedAt, values, lists, replies }),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
