/**
 * The read-only demo's way to the engine (`docs/development.md`, "Demo"):
 * no engine at all. A snapshot the exporter took from the real engine
 * (`apps/desktop/web/demo/export`) answers each request in the page, in
 * place of the port or the socket.
 *
 * The snapshot holds route answers as the wire carries them, JSON-encoded
 * by the route's own schema, so the client decodes them as it decodes the
 * engine's. Each is keyed by route tag and canonical encoded payload;
 * a list is stored whole, without its `range`, and each subscription gets
 * the window its range asks for. Live streams send one message and stay
 * open until the client lets them go.
 *
 * A request the snapshot cannot answer is a miss: it is reported to
 * `onMiss` and never answered, so the coverage test fails on it and a
 * visitor sees a placeholder rather than made-up data.
 */
import { Effect, Layer, Schema } from 'effect'
import { RpcClient, type RpcMessage, type Rpc } from 'effect/rpc'
import { AllRoutes, liveKindOf, MESSAGE_WINDOW_BEFORE } from '@juno/contract'
import { connectionReporter, engineProtocolAtom, type Registry } from './client'
import type { EngineProtocol } from './transport'

export const DEMO_SNAPSHOT_VERSION = 1

/** A whole list as the engine answered it: every row, in order, with the refs they name. */
export interface DemoList {
  readonly order: ReadonlyArray<string>
  readonly rows: Readonly<Record<string, unknown>>
  readonly refs?: unknown
  /** The engine's flags for the whole list (`windowCovered`, `quietDays`, `total`), without timings. */
  readonly meta: Readonly<Record<string, unknown>>
}

export interface DemoSnapshot {
  readonly version: typeof DEMO_SNAPSHOT_VERSION
  /** The commit the exporter ran at; the renderer built with it must match. */
  readonly commit: string
  /** Engine clock when the export ran, epoch milliseconds. */
  readonly capturedAt: number
  /** Live values, by `demoKey`. */
  readonly values: Readonly<Record<string, unknown>>
  /** Live lists, by `demoKey` of the payload without `range`. */
  readonly lists: Readonly<Record<string, DemoList>>
  /** One-shot requests, by `demoKey`. */
  readonly replies: Readonly<Record<string, unknown>>
}

/** A request the snapshot has no answer for: the route and its encoded payload. */
export interface DemoMiss {
  readonly tag: string
  readonly payload: unknown
}

/**
 * The key of one answer: the tag and the encoded payload with object keys
 * sorted, as `liveQuery` keys its atoms. `undefined` and `{}` differ.
 */
export function demoKey(tag: string, payload: unknown): string {
  if (payload === undefined) return `${tag} undefined`
  return `${tag} ${JSON.stringify(payload, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  )}`
}

/**
 * The key a whole list is stored under: its payload without `range`, and
 * for `messages.list` without `before`, which only shapes the window.
 */
export function demoListKey(tag: string, payload: unknown): string {
  const { range: _range, ...rest } = payload as { readonly range?: unknown }
  if (tag !== 'messages.list') return demoKey(tag, rest)
  const { before: _before, ...topic } = rest as { readonly before?: unknown }
  return demoKey(tag, topic)
}

/**
 * The payload a one-shot answer is stored under. Paging a topic whose
 * history the snapshot holds whole has one answer, whatever the cursor.
 */
export function demoReplyPayload(tag: string, payload: unknown): unknown {
  if (tag !== 'messages.loadOlder' && tag !== 'messages.loadNewer') return payload
  return { id: (payload as { readonly id: string }).id }
}

/**
 * Commands that normal reading sends by itself (saving the open tabs,
 * marking a topic read). The demo keeps nothing, so each succeeds with
 * this value and changes nothing.
 */
const HOUSEKEEPING: Readonly<Record<string, unknown>> = {
  'prefs.set': undefined,
  'reads.markRead': {},
}

interface Range {
  readonly anchor?: string
  readonly limit: number
}

/** The rows a subscription's range covers, and its window flags. */
function windowOf(tag: string, list: DemoList, range: Range, before: number | undefined): { readonly order: ReadonlyArray<string>; readonly meta: Record<string, unknown> } {
  const { order } = list
  const at = range.anchor === undefined ? -1 : order.indexOf(range.anchor)
  if (tag === 'messages.list') {
    // `messages.list`: the newest rows without an anchor, else up to `before` rows older than it and then the newer ones.
    const start = at < 0 ? Math.max(0, order.length - range.limit) : Math.max(0, at - (before ?? MESSAGE_WINDOW_BEFORE))
    const window = order.slice(start, start + range.limit)
    return { order: window, meta: { ...list.meta, total: window.length, atNewest: start + window.length >= order.length } }
  }
  return { order: order.slice(Math.max(0, at), Math.max(0, at) + range.limit), meta: list.meta }
}

function encodeSuccess(rpc: Rpc.AnyWithProps, value: unknown): unknown {
  return Schema.encodeSync(Schema.toCodecJson(rpc.successSchema as Schema.Codec<unknown, unknown>))(value)
}

/** One request's answer as wire messages, or undefined for a miss. */
function answer(snapshot: DemoSnapshot, request: RpcMessage.RequestEncoded): ReadonlyArray<RpcMessage.FromServerEncoded> | undefined {
  const rpc = AllRoutes.requests.get(request.tag) as Rpc.AnyWithProps | undefined
  if (rpc === undefined) return undefined
  const requestId = request.id
  const meta = { seq: 1, queryMs: 0, encodeMs: 0, at: snapshot.capturedAt }
  const kind = liveKindOf(rpc)
  if (kind === 'value') {
    const key = demoKey(request.tag, request.payload)
    // An unset preference is the engine's null.
    const value = key in snapshot.values ? snapshot.values[key] : request.tag === 'prefs.get' ? null : undefined
    if (value === undefined) return undefined
    return [{ _tag: 'Chunk', requestId, values: [{ value, meta }] }]
  }
  if (kind === 'list') {
    const { range, before } = request.payload as { readonly range: Range; readonly before?: number }
    const list = snapshot.lists[demoListKey(request.tag, request.payload)]
    if (list === undefined) return undefined
    const window = windowOf(request.tag, list, range, before)
    const delta = {
      reset: true,
      order: window.order,
      upsert: window.order.map((id) => list.rows[id]),
      remove: [],
      ...(list.refs === undefined ? {} : { refs: list.refs }),
      meta: { ...window.meta, ...meta },
    }
    return [{ _tag: 'Chunk', requestId, values: [delta] }]
  }
  const key = demoKey(request.tag, demoReplyPayload(request.tag, request.payload))
  if (key in snapshot.replies) return [{ _tag: 'Exit', requestId, exit: { _tag: 'Success', value: snapshot.replies[key] } }]
  if (request.tag in HOUSEKEEPING) return [{ _tag: 'Exit', requestId, exit: { _tag: 'Success', value: encodeSuccess(rpc, HOUSEKEEPING[request.tag]) } }]
  return undefined
}

function demoProtocol(snapshot: Promise<DemoSnapshot>, onMiss: (miss: DemoMiss) => void, onState: (state: 'connected') => void): EngineProtocol {
  return Layer.effect(
    RpcClient.Protocol,
    RpcClient.Protocol.make((write) =>
      Effect.sync(() => {
        onState('connected')
        return {
          send: (clientId, message) => {
            if (message._tag !== 'Request') return Effect.void
            return Effect.promise(() => snapshot).pipe(
              Effect.flatMap((loaded) => {
                const replies = answer(loaded, message)
                if (replies === undefined) {
                  onMiss({ tag: message.tag, payload: message.payload })
                  return Effect.void
                }
                return Effect.forEach(replies, (reply) => write(clientId, reply), { discard: true })
              }),
            )
          },
          supportsAck: false,
          supportsTransferables: false,
          codecFor: Schema.toCodecJson as RpcClient.Protocol['Service']['codecFor'],
        }
      }),
    ),
  )
}

/**
 * Answers every engine request on `target` from `snapshot`, once it has
 * loaded, so the shell can paint while it downloads. Call before the first
 * live query.
 */
export function configureDemoConnection(target: Registry, snapshot: Promise<DemoSnapshot>, onMiss: (miss: DemoMiss) => void): void {
  target.set(engineProtocolAtom, demoProtocol(snapshot, onMiss, connectionReporter(target)))
}
