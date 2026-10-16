/**
 * The projection `outbox.ts` compares (README, "Conformance"): the model's
 * side, read from a trace state, and the engine's, read from the store,
 * the fake's messages and its gated calls.
 */
import type { GatedCall } from '@juno/fake-slack'
import type { EngineOptions, RunningEngine } from '../harness'
import { readDb } from '../scenario'
import type { TraceState } from './itf'

export const DRAFTS = [1, 2] as const
export type Draft = (typeof DRAFTS)[number]
export const CHANNEL: Record<Draft, string> = { 1: 'C0ENG', 2: 'C0PRODUCT' }
export const TEXT = 'The same text in both drafts'
/** Marks the copy the harness makes as the network: it is not gated. */
export const RESEND = 'network-resend'

/** The model's state variable `s`, decoded. */
export interface S {
  readonly created: ReadonlySet<number>
  /** The root a reply was queued under from New chat's pending thread, or 0. */
  readonly parent?: ReadonlyMap<number, number>
  readonly row: ReadonlyMap<number, string>
  readonly stored: ReadonlySet<number>
  readonly server: ReadonlyMap<number, number>
  readonly due: ReadonlySet<number>
  readonly discarded: ReadonlySet<number>
  readonly stale: ReadonlySet<number>
  readonly request: ReadonlyMap<number, string>
  readonly events: ReadonlySet<number>
  readonly fetches: ReadonlySet<{ readonly key: number; readonly found: boolean; readonly kind: string }>
  readonly connected: boolean
  readonly label: string
  readonly target: number
  readonly act: ReadonlyMap<number, string>
  readonly actKind: ReadonlyMap<number, string>
  readonly dup: ReadonlyMap<number, number>
  readonly deletes: ReadonlyMap<number, number>
  readonly copyRow: ReadonlyMap<number, string>
  readonly kept: ReadonlyMap<number, string>
  readonly slack: ReadonlySet<{ readonly key: number; readonly what: string }>
  readonly rechecked: ReadonlySet<number>
}
export const sOf = (state: TraceState) => state['s'] as unknown as S

/** What both sides are compared on, per draft. */
export interface DraftView {
  /** The pending row: queued, sending, unknown, failed, or gone. */
  readonly row: string
  /** Juno stored a message with the draft's `client_msg_id`. */
  readonly stored: boolean
  /** Juno's post call: idle, transit (Slack has not run it), accepted, refused or later (its answer waits). */
  readonly request: string
  /** A lookup for the post is out. */
  readonly lookup: boolean
  /** A queued or unknown row is due: its backoff has ended. Undefined for other rows and while a lookup is out. */
  readonly due?: boolean
  /** Messages Slack holds with the draft's `client_msg_id`. */
  readonly slack: number
  /** The network copy in Juno's store: none, hidden (its delete waits), kept, or shown. */
  readonly copy: string
  /** Which message Juno keeps: the first it stored, or the copy. */
  readonly kept: string
  /** The user's edit or delete: idle, or waiting, transit or accepted, and its kind. */
  readonly act: string
}
export interface View {
  readonly d1: DraftView
  readonly d2: DraftView
  readonly connected: boolean
}

// The model's side

const PENDING = new Set(['waiting', 'transit', 'accepted'])
const held = (s: S, k: number) =>
  s.server.get(k)! + s.dup.get(k)! - s.deletes.get(k)! - ([...s.slack].some((c) => c.key === k && c.what === 'gone') ? 1 : 0)

/**
 * Whether the user's own delete of the draft's message reached Slack by `index`. The model counts it nowhere
 * else. A delete that replaced an edit whose call was out (`stale`) is not the call Slack accepted then.
 */
const userDeleted = (states: ReadonlyArray<TraceState>, index: number, k: number) =>
  states.slice(1, index + 1).some((state, i) => {
    const prev = sOf(states[i]!)
    const next = sOf(state)
    return (
      next.label === 'actAccept' &&
      next.target === k &&
      prev.actKind.get(k) === 'delete' &&
      !prev.stale.has(k) &&
      // Once the copy is the message, the user's delete removes it.
      (prev.kept.get(k) === 'copy' || ![...prev.slack].some((c) => c.key === k && c.what === 'gone'))
    )
  })

/**
 * The calls on the client's send lane by `index`, oldest first: only the
 * first is at Slack. The model leaves the lane out; the engine runs one
 * write at a time (outbox-conformance.qnt).
 */
function lane(states: ReadonlyArray<TraceState>, index: number): ReadonlyArray<string> {
  let calls: Array<string> = []
  for (let i = 1; i <= index; i++) {
    const prev = sOf(states[i - 1]!)
    const { label, target } = sOf(states[i]!)
    const post = `post${target}`
    const act = `act${target}`
    if (label === 'claim') calls.push(post)
    else if (label === 'runAction') calls.push(act)
    else if (label === 'crash') calls = []
    else if ((label === 'answer' || label === 'refused' || label === 'lost') && prev.request.get(target) !== 'idle') calls = calls.filter((c) => c !== post)
    else if (label === 'actAnswer' || label === 'actRefuse' || label === 'actFail') calls = calls.filter((c) => c !== act)
  }
  return calls
}

export function expectedDraft(states: ReadonlyArray<TraceState>, index: number, k: number): DraftView {
  const s = sOf(states[index]!)
  // Traces of outbox-conformance.qnt carry the lane; for the directed schedules it is read from the steps.
  const front = ((states[index]!['lane'] as ReadonlyArray<string> | undefined) ?? lane(states, index))[0]
  // A call that left its worker but waits for the lane has not reached Slack.
  const request = s.request.get(k) === 'transit' && front !== `post${k}` ? 'waiting' : s.request.get(k)!
  const act = s.act.get(k) === 'transit' && front !== `act${k}` ? 'waiting' : s.act.get(k)!
  const lookup = [...s.fetches].some((f) => f.key === k && f.kind === 'lookup')
  const waits = (s.row.get(k) === 'queued' || s.row.get(k) === 'unknown') && !lookup
  return {
    row: s.row.get(k)!,
    stored: s.stored.has(k),
    request,
    lookup,
    ...(waits ? { due: s.due.has(k) } : {}),
    slack: Math.max(0, held(s, k) - (userDeleted(states, index, k) ? 1 : 0)),
    // The copy that became the message goes with the user's delete, once its echo or answer is stored.
    copy:
      s.kept.get(k) === 'copy' && userDeleted(states, index, k) && (s.connected || s.act.get(k) === 'done') ? 'none' : s.copyRow.get(k)!,
    kept: s.kept.get(k)!,
    act: PENDING.has(act) ? `${act} ${s.actKind.get(k)}` : 'idle',
  }
}

// The engine's side

export interface World {
  engine: RunningEngine
  readonly options: EngineOptions
  readonly ids: Record<Draft, string>
  /** Each draft's channel: its own, or its root's for a reply (`sendReply`). */
  readonly channel: Record<Draft, string>
  /** Drafts sent as New chat thread roots, because a reply names them. */
  readonly roots: ReadonlySet<Draft>
  /** The first message Juno stored for each draft. */
  readonly first: Map<Draft, string>
  /** Slack's message from Juno's own accepted call, and the network's copy. */
  readonly post: Map<Draft, string>
  readonly copy: Map<Draft, string>
  /** Copies whose echo waits in the fake. */
  readonly copyFrames: Set<Draft>
  /** Drafts whose copy's next delete may go out. */
  readonly allowDelete: Set<Draft>
  /** Copy deletes the policy decided, to answer. */
  readonly decided: Set<number>
  /** The app is closed after a crash. */
  closed: boolean
  offline: boolean
  edits: number
  readonly timer: ReturnType<typeof setInterval>
}

export const draftOf = (world: World, id: string | undefined): Draft | undefined => DRAFTS.find((k) => world.ids[k] === id)
export const draftOfChannel = (channel: string | undefined): Draft | undefined => DRAFTS.find((k) => CHANNEL[k] === channel)

export const isPost = (world: World, method: string, args: Readonly<Record<string, string>>) =>
  method === 'chat.postMessage' && draftOf(world, args['client_msg_id']) !== undefined && args['_x_reason'] !== RESEND
export const isLookup = (method: string, args: Readonly<Record<string, string>>) =>
  method === 'conversations.history' && draftOfChannel(args['channel']) !== undefined && args['_x_reason'] === undefined
export const isAction = (method: string, args: Readonly<Record<string, string>>) =>
  ['chat.update', 'chat.delete', 'reactions.add', 'reactions.remove'].includes(method) && draftOfChannel(args['channel']) !== undefined

interface Stored {
  readonly ts: string
  readonly deleted: number
}
interface Store {
  readonly row: string | undefined
  readonly due: boolean
  readonly sentTs: string | null | undefined
  readonly messages: ReadonlyArray<Stored>
  readonly keptCopies: ReadonlyArray<{ readonly ts: string; readonly hidden: number }>
  readonly copyDeletes: ReadonlyArray<string>
  readonly actions: ReadonlyArray<string>
  /** The ts the user's own deletes name. */
  readonly userDeletes: ReadonlyArray<string>
}

export function readStore(world: World, k: Draft): Store {
  const id = world.ids[k]
  const channel = world.channel[k]
  return readDb(world.engine, 'user.db', (db) => {
    const pending = db.prepare('SELECT state, next_at FROM pending_messages WHERE client_msg_id = ?').get(id) as { state: string; next_at: number } | undefined
    const row = pending?.state
    const due = pending === undefined ? false : pending.next_at <= Date.now()
    const sentTs = (db.prepare('SELECT ts FROM sent_posts WHERE client_msg_id = ?').get(id) as { ts: string | null } | undefined)?.ts
    const keptCopies = db.prepare('SELECT ts, hidden FROM kept_copies WHERE channel = ? AND client_msg_id = ?').all(channel, id) as Array<{ ts: string; hidden: number }>
    const outbox = db.prepare('SELECT kind, depends_on, payload_json FROM outbox WHERE target_key = ? ORDER BY id').all(channel) as Array<{ kind: string; depends_on: string | null; payload_json: string }>
    const copyDeletes: Array<string> = []
    const actions: Array<string> = []
    const userDeletes: Array<string> = []
    for (const action of outbox) {
      const payload = JSON.parse(action.payload_json) as { ts: string | null; clientMsgId: string | null }
      if (action.kind === 'delete' && action.depends_on === null && payload.clientMsgId === null && payload.ts !== null) copyDeletes.push(payload.ts)
      else if (payload.clientMsgId === id || action.depends_on === id) {
        actions.push(action.kind === 'delete' ? 'delete' : 'change')
        if (action.kind === 'delete' && payload.ts !== null) userDeletes.push(payload.ts)
      }
    }
    return { row, due, sentTs, keptCopies, copyDeletes, actions, userDeletes, messages: [] }
  }) satisfies Store
}

export function storedMessages(world: World, k: Draft): ReadonlyArray<Stored> {
  return readDb(world.engine, 'cache.db', (db) => db.prepare('SELECT ts, deleted FROM messages WHERE channel = ? AND client_msg_id = ?').all(world.channel[k], world.ids[k]) as Array<{ ts: string; deleted: number }>)
}

export const inSlack = (world: World, k: Draft) => world.engine.fake.messages(world.channel[k]).filter((m) => m.client_msg_id === world.ids[k])

/** The copy's ts in Slack: the message with the draft's id that is not the first Juno stored (or not Juno's own call's). */
export const copyInSlack = (world: World, k: Draft) => {
  const first = world.first.get(k) ?? world.post.get(k)
  return inSlack(world, k).find((m) => m.ts !== first)?.ts
}

/**
 * A copy's delete, as opposed to the user's own delete: a delete of a
 * message with the draft's id that is not the one Juno keeps. Read by ts,
 * not by the outbox row, which a reply can drop while the call is out.
 */
export const isCopyDelete = (world: World, call: GatedCall) => {
  const k = draftOfChannel(call.args['channel'])
  if (call.method !== 'chat.delete' || k === undefined) return false
  const ts = call.args['ts'] ?? ''
  const store = readStore(world, k)
  return ts !== store.sentTs && !store.userDeletes.includes(ts) && storedMessages(world, k).some((m) => m.ts === ts)
}

export function observeDraft(world: World, k: Draft): DraftView {
  const store = readStore(world, k)
  const messages = storedMessages(world, k)
  if (!world.first.has(k) && store.sentTs != null) world.first.set(k, store.sentTs)
  const first = world.first.get(k)
  const gated = world.engine.fake.gated()
  const posts = gated.filter((call) => isPost(world, call.method, call.args) && draftOf(world, call.args['client_msg_id']) === k)
  // A row still sending while the app is closed is unknown: the next start recovers it as such (`recoverPosts`).
  const row = store.row === 'sending' && world.closed ? 'unknown' : (store.row ?? 'gone')
  const request =
    posts.length === 0
      ? row === 'sending'
        ? 'waiting'
        : 'idle'
      : posts.length > 1
        ? `${posts.length} calls`
        : posts[0]!.stage === 'before'
          ? 'transit'
          : posts[0]!.outcome === 'ran'
            ? 'accepted'
            : posts[0]!.outcome === 'ratelimited'
              ? 'later'
              : 'refused'
  const other = messages.find((m) => m.ts !== first)
  const copy =
    other === undefined || other.deleted === 1
      ? 'none'
      : store.keptCopies.some((c) => c.ts === other.ts && c.hidden === 0)
        ? 'kept'
        : store.copyDeletes.includes(other.ts)
          ? 'hidden'
          : 'shown'
  const calls = gated.filter((call) => isAction(call.method, call.args) && draftOfChannel(call.args['channel']) === k && !isCopyDelete(world, call))
  const act =
    store.actions.length === 0
      ? 'idle'
      : `${calls.length === 0 ? 'waiting' : calls.length > 1 ? `${calls.length} calls` : calls[0]!.stage === 'before' ? 'transit' : 'accepted'} ${store.actions.at(-1)}`
  const lookup = gated.some((call) => isLookup(call.method, call.args) && draftOfChannel(call.args['channel']) === k)
  return {
    row,
    stored: messages.length > 0,
    request,
    lookup,
    // A closed app has no timers; its rows are due when it starts (`recoverPosts`, the boot's flush).
    ...((row === 'queued' || row === 'unknown') && !lookup ? { due: world.closed ? true : store.due } : {}),
    slack: inSlack(world, k).length,
    copy,
    kept: first === undefined || store.sentTs === first ? 'first' : 'copy',
    act,
  }
}
