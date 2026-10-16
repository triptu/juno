/**
 * `specs/outbox.qnt` against the engine: how each step is driven, and the
 * projection both sides are compared on (README, "Conformance").
 *
 * Draft 1 posts to #eng and draft 2 to #product, each with the same text,
 * as in the model. Two channels keep the drafts apart, as the model does:
 * the workers hold a channel's later rows behind an earlier one.
 *
 * The fake gates every call Slack decides in the model: Juno's posts, its
 * lookups, and its edits and deletes. A post waits before Slack runs it
 * (`transit`) and again before its answer (`accepted`, `refused` or
 * `later`). A lookup runs when it arrives, so its page is Slack's state
 * at request time, and its answer waits (`finishFetch`). Echoes of Juno's
 * posts wait in the fake until the trace delivers or drops them.
 *
 * A copy's delete is the one call Juno repeats without the trace asking:
 * it is held when it arrives, and refused (`request_timeout`, Slack's
 * trouble) before any other step, so the check before the next attempt
 * sees that step. `deleteCopy` lets the next attempt through. The model
 * counts only the successful delete; the refusals are stutters.
 */
import { rm } from 'node:fs/promises'
import { messagesSend } from '@juno/contract'
import type { GatedCall } from '@juno/fake-slack'
import { deleteMessage, discardMessage, editMessage, retryMessage, runCommand } from '@juno/state'
import { Exit } from 'effect'
import { startTestEngine, waitFor, type EngineOptions, type RunningEngine } from '../harness'
import { bootedEngine, quiet, readDb } from '../scenario'
import type { Trace, TraceState } from './itf'
import {
  CHANNEL,
  DRAFTS,
  RESEND,
  TEXT,
  copyInSlack,
  draftOf,
  draftOfChannel,
  expectedDraft,
  inSlack,
  isAction,
  isCopyDelete,
  isLookup,
  isPost,
  observeDraft,
  readStore,
  sOf,
  storedMessages,
  type Draft,
  type S,
  type View,
  type World,
} from './outbox-view'
import type { Spec } from './replay'

const STEP_MS = 15_000

// Driving the steps

/** The one gated call of a draft that `match` picks, once it is there. */
const gatedCall = (world: World, label: string, match: (call: GatedCall) => boolean) =>
  waitFor(
    () => {
      const found = world.engine.fake.gated().filter(match)
      if (found.length > 1) throw new Error(`${found.length} gated calls for ${label}`)
      return found[0]
    },
    STEP_MS,
    label,
  )

const postCall = (world: World, k: Draft, stage: GatedCall['stage']) =>
  gatedCall(world, `the post of draft ${k} at ${stage}`, (call) => isPost(world, call.method, call.args) && draftOf(world, call.args['client_msg_id']) === k && call.stage === stage)
const actionCall = (world: World, k: Draft, stage?: GatedCall['stage']) =>
  gatedCall(
    world,
    `an action call of draft ${k}${stage === undefined ? '' : ` at ${stage}`}`,
    (call) => isAction(call.method, call.args) && draftOfChannel(call.args['channel']) === k && !isCopyDelete(world, call) && (stage === undefined || call.stage === stage),
  )

/** Decides a call at `before` and waits for it at `answer`. */
async function decideBefore(world: World, call: GatedCall, decision: Parameters<RunningEngine['fake']['decide']>[1], label: string) {
  world.engine.fake.decide(call.id, decision)
  if (decision === 'drop') return
  await gatedCall(world, `${label} at answer`, (next) => next.method === call.method && next.stage === 'answer' && JSON.stringify(next.args) === JSON.stringify(call.args))
}

const isOwnFrame = (world: World) => (frame: { readonly type: string; readonly subtype?: string; readonly client_msg_id?: string }) =>
  frame.type === 'message' && frame.subtype === undefined && draftOf(world, frame.client_msg_id) !== undefined
const frameOf = (ts: string) => (frame: { readonly type: string; readonly ts?: string; readonly subtype?: string }) => frame.type === 'message' && frame.subtype === undefined && frame.ts === ts

/**
 * Lookups run when they arrive. A copy's delete runs when the trace allows
 * it and is refused otherwise (holding it would hold the send lane, which
 * the model's waiting delete does not). Copy deletes are then answered.
 */
function policy(world: World) {
  if (world.closed) return
  const { fake } = world.engine
  for (const call of fake.gated()) {
    try {
      if (call.stage === 'answer') {
        if (world.decided.delete(call.id)) fake.decide(call.id, 'answer')
      } else if (isLookup(call.method, call.args)) fake.decide(call.id, 'run')
      else if (isCopyDelete(world, call)) decideCopy(world, call, world.allowDelete.delete(draftOfChannel(call.args['channel'])!) ? 'run' : { error: 'request_timeout' })
    } catch {
      // The store is being replaced (a restart), or the call was just decided; the next tick looks again.
    }
  }
}

/** Decides a copy delete at `before`; the call keeps its id at `answer`, where the policy answers it. */
function decideCopy(world: World, call: GatedCall, decision: 'run' | { readonly error: string }) {
  world.decided.add(call.id)
  world.engine.fake.decide(call.id, decision)
}

function gate(world: World) {
  const { fake } = world.engine
  fake.gate((method, args) => isPost(world, method, args) || isLookup(method, args) || isAction(method, args))
  fake.holdFramesWhere(isOwnFrame(world))
}

async function startEngine(world: World) {
  const { fake, userData } = world.engine
  const credentials = fake.credentials()
  world.engine = await startTestEngine({ ...world.options, reuse: { userData, fake, credentials }, initial: () => credentials })
  world.engine.main.network.offline = world.offline
  world.closed = false
  await world.engine.status('ready')
}

async function stopEngine(world: World) {
  world.closed = true
  world.engine.registry.dispose()
  await world.engine.handle.stop()
}

async function command(exit: Promise<Exit.Exit<unknown, unknown>>, label: string) {
  const result = await exit
  if (Exit.isFailure(result)) throw new Error(`${label} failed: ${JSON.stringify(result.cause)}`)
}

/** The message the user acts on: the one Juno keeps, or the copy it shows once that one is deleted, or the pending post. */
const messageRef = (world: World, k: Draft) => {
  const store = readStore(world, k)
  const live = storedMessages(world, k).filter((m) => m.deleted === 0)
  const ts = live.find((m) => m.ts === store.sentTs)?.ts ?? live[0]?.ts ?? `pending:${world.ids[k]}`
  return { channelId: world.channel[k], ts, clientMsgId: world.ids[k] }
}

/** One step the harness drives, with the model's states on either side of it. */
interface Step {
  readonly prev: S
  readonly next: S
  readonly k: Draft
  readonly state: TraceState
}
type Drive = (world: World, step: Step) => Promise<void> | void

// The network sends Juno's accepted request again: Slack runs it a second time.
async function resend(world: World, { prev, k }: Step) {
  const { fake } = world.engine
  const call = await postCall(world, k, 'answer')
  const credentials = fake.credentials()
  const body = new FormData()
  for (const [name, value] of Object.entries({ ...call.args, token: credentials.token, _x_reason: RESEND })) body.append(name, value)
  const response = await fetch(`${fake.url}/api/chat.postMessage`, { method: 'POST', body, headers: { cookie: `d=${credentials.cookie}` } })
  const answer = (await response.json()) as { ok: boolean; ts?: string }
  if (!answer.ok || answer.ts === undefined) throw new Error(`the resend failed: ${JSON.stringify(answer)}`)
  world.copy.set(k, answer.ts)
  if (prev.connected) world.copyFrames.add(k)
  else fake.releaseFramesWhere(frameOf(answer.ts), true)
}

// Slack decides the calls in transit; every answer is lost with the process.
async function crash(world: World, { prev, next }: Step) {
  const { fake } = world.engine
  const ran: Array<number> = []
  for (const call of fake.gated()) {
    const draft = draftOf(world, call.args['client_msg_id'])
    const accepted = isPost(world, call.method, call.args) && draft !== undefined && next.server.get(draft)! > prev.server.get(draft)!
    if (call.stage !== 'before') continue
    fake.decide(call.id, accepted ? 'run' : 'drop')
    if (accepted) ran.push(call.id)
  }
  await waitFor(() => (ran.every((id) => fake.gated().some((call) => call.id === id && call.stage === 'answer')) ? true : undefined), STEP_MS, 'the accepted calls ran')
  for (const call of fake.gated()) fake.decide(call.id, call.stage === 'before' ? 'drop' : 'lose')
  for (const draft of DRAFTS) {
    const ts = inSlack(world, draft).find((m) => m.ts !== world.copy.get(draft) && m.ts !== world.post.get(draft))?.ts
    if (ts !== undefined) world.post.set(draft, ts)
  }
  fake.releaseFramesWhere(isOwnFrame(world), true)
  world.copyFrames.clear()
  await stopEngine(world)
  // The model's crash leaves the socket up; the engine's restart then boots warm.
  if (next.connected) await startEngine(world)
}

function queueAction(world: World, { prev, next, k, state }: Step) {
  world.edits += 1
  // On a queued or failed post the model changes the row, not `actKind`: the step's pick says which it was.
  const picked = (state['picks'] as Readonly<Record<string, { tag: string; value: unknown }>> | undefined)?.['kind']
  const kind = picked?.tag === 'Some' ? picked.value : next.discarded.has(k) && !prev.discarded.has(k) ? 'delete' : next.actKind.get(k)
  return kind === 'delete'
    ? command(deleteMessage(world.engine.registry, messageRef(world, k)), 'delete')
    : command(editMessage(world.engine.registry, messageRef(world, k), `Edited ${world.edits}`), 'edit')
}

function remoteChange(world: World, { prev, next, k }: Step) {
  const { fake } = world.engine
  const change = [...next.slack].find((c) => c.key === k && ![...prev.slack].some((p) => p.key === c.key && p.what === c.what))!
  if (change.what === 'gone') return fake.deleteMessage({ channel: world.channel[k], ts: world.first.get(k)! })
  const copy = copyInSlack(world, k)
  if (copy === undefined) throw new Error(`draft ${k} has no copy in Slack`)
  fake.injectMessage({ channel: world.channel[k], user: 'U0MAYA', text: 'A reply to the copy', threadTs: copy })
}

async function accept(world: World, { next, k }: Step) {
  await decideBefore(world, await postCall(world, k, 'before'), 'run', `the post of draft ${k}`)
  const ts = inSlack(world, k).find((m) => m.ts !== world.copy.get(k) && m.ts !== world.post.get(k))?.ts
  if (ts === undefined) throw new Error('the accepted post is not in Slack')
  world.post.set(k, ts)
  if (!next.events.has(k)) world.engine.fake.releaseFramesWhere(frameOf(ts), true)
}

/** Decides an action call at `before` with an error, then answers it. */
async function refuseAction(world: World, k: Draft, error: (call: GatedCall) => string) {
  const call = await actionCall(world, k, 'before')
  await decideBefore(world, call, { error: error(call) }, `the action of draft ${k}`)
  world.engine.fake.decide((await actionCall(world, k, 'answer')).id, 'answer')
}

function drop(world: World, { next }: Step) {
  if (next.label === 'goOffline') {
    world.offline = true
    world.engine.main.network.offline = true
  }
  world.engine.fake.goOffline()
  world.engine.fake.releaseFramesWhere(isOwnFrame(world), true)
  world.copyFrames.clear()
}

function release(world: World, ts: string | undefined, what: string) {
  if (world.engine.fake.releaseFramesWhere(frameOf(ts ?? '')) !== 1) throw new Error(`no echo of ${what} waits`)
}

const answerPost = (outcome: 'answer' | 'lose'): Drive => async (world, { k }) => world.engine.fake.decide((await postCall(world, k, 'answer')).id, outcome)

/** How the harness drives each step of the world, by the model's action. */
const drive: Readonly<Record<string, Drive>> = {
  // A draft a reply names goes as a New chat thread root, so the reply can name it before Slack has it.
  send: (world, { k }) =>
    command(
      runCommand(world.engine.registry, messagesSend, {
        to: { kind: 'channel', channelId: world.channel[k] },
        text: TEXT,
        clientMsgId: world.ids[k],
        ...(world.roots.has(k) ? { startThread: true } : {}),
      }),
      'send',
    ),
  // A reply queued in the root's pending thread: it names the root by its `client_msg_id`.
  sendReply: (world, { next, k }) =>
    command(
      runCommand(world.engine.registry, messagesSend, {
        to: { kind: 'channel', channelId: world.channel[k], threadTs: `pending:${world.ids[next.parent!.get(k) as Draft]}` },
        text: TEXT,
        clientMsgId: world.ids[k],
      }),
      'sendReply',
    ),
  accept,
  refuse: async (world, { next, k }) =>
    decideBefore(world, await postCall(world, k, 'before'), next.request.get(k) === 'later' ? { error: 'ratelimited', status: 429, retryAfter: 1 } : { error: 'restricted_action' }, `the post of draft ${k}`),
  drop: async (world, { k }) => world.engine.fake.decide((await postCall(world, k, 'before')).id, 'drop'),
  answer: answerPost('answer'),
  refused: answerPost('answer'),
  lost: answerPost('lose'),
  resend,
  echo: (world, { k }) => release(world, world.post.get(k), `draft ${k}`),
  observeCopy: (world, { k }) => {
    world.copyFrames.delete(k)
    release(world, world.copy.get(k), `the copy of draft ${k}`)
  },
  deleteCopy: (world, { k }) => void world.allowDelete.add(k),
  remoteChange,
  finishFetch: async (world, { k }) =>
    world.engine.fake.decide((await gatedCall(world, `the lookup of draft ${k}`, (c) => isLookup(c.method, c.args) && draftOfChannel(c.args['channel']) === k && c.stage === 'answer')).id, 'answer'),
  retry: (world, { k }) => command(retryMessage(world.engine.registry, world.ids[k]), 'retry'),
  discard: (world, { k }) => command(discardMessage(world.engine.registry, world.ids[k]), 'discard'),
  queueAction,
  actAccept: async (world, { k }) => decideBefore(world, await actionCall(world, k, 'before'), 'run', `the action of draft ${k}`),
  actAnswer: async (world, { k }) => world.engine.fake.decide((await actionCall(world, k, 'answer')).id, 'answer'),
  // Before Slack ran it: Slack's own trouble, which the worker tries again. After: the answer is lost.
  actFail: async (world, { k }) => {
    const call = await actionCall(world, k)
    if (call.stage === 'answer') return world.engine.fake.decide(call.id, 'lose')
    return refuseAction(world, k, () => 'request_timeout')
  },
  actRefuse: (world, { k }) => refuseAction(world, k, (call) => (call.method === 'chat.delete' ? 'cant_delete_message' : 'cant_update_message')),
  disconnect: drop,
  goOffline: drop,
  goOnline: (world) => {
    world.offline = false
    world.engine.main.network.offline = false
  },
  reconnect: async (world) => {
    world.engine.fake.goOnline()
    if (world.closed) await startEngine(world)
  },
  crash,
  seal: () => {},
  idle: () => {},
}

async function perform(world: World, prevState: TraceState, nextState: TraceState): Promise<void> {
  const next = sOf(nextState)
  const step = drive[next.label]
  if (step === undefined) throw new Error(`no mapping for ${next.label}`)
  await step(world, { prev: sOf(prevState), next, k: next.target as Draft, state: nextState })
}

/** Steps Juno takes on its own; the harness waits for them. */
function own(world: World, prevState: TraceState, nextState: TraceState): boolean {
  // Traces of outbox-conformance.qnt say which steps were Juno's; the directed schedules of outbox.qnt do not.
  if (nextState['by'] !== undefined) return nextState['by'] === 'juno'
  const prev = sOf(prevState)
  const next = sOf(nextState)
  switch (next.label) {
    case 'claim':
    case 'wake':
    case 'startFetch':
    case 'runAction':
    case 'dropAction':
    case 'keepCopy':
    case 'catchUp':
      return true
    case 'lost':
      return prev.request.get(next.target) === 'dropped'
    case 'observeCopy':
      return !world.copyFrames.has(next.target as Draft)
    case 'finishFetch':
      return [...prev.fetches].some((f) => f.kind === 'catchup' && ![...next.fetches].some((g) => g.key === f.key && g.kind === f.kind && g.found === f.found))
    default:
      return false
  }
}

export const outboxSpec: Spec<World, View> = {
  start: async (trace: Trace) => {
    // A catch-up that reads no topic again needs a recheck that reads none.
    const covers = trace.states.every((state) => sOf(state).label !== 'catchUp' || sOf(state).rechecked.size > 0)
    const options: EngineOptions = covers ? {} : { recheckTopics: 0 }
    // A reply lives in its root's channel. Lookups and edits are matched by channel, so a trace with a
    // reply must have neither (the New chat schedules do not).
    const parent = sOf(trace.states.at(-1)!).parent ?? new Map<number, number>()
    const channel = { ...CHANNEL }
    for (const k of DRAFTS) {
      const root = parent.get(k) ?? 0
      if (root !== 0) channel[k] = CHANNEL[root as Draft]
    }
    const world: World = {
      engine: await bootedEngine([], options),
      options,
      ids: { 1: crypto.randomUUID(), 2: crypto.randomUUID() },
      channel,
      roots: new Set(DRAFTS.filter((k) => DRAFTS.some((j) => parent.get(j) === k))),
      first: new Map(),
      post: new Map(),
      copy: new Map(),
      copyFrames: new Set(),
      allowDelete: new Set(),
      decided: new Set(),
      closed: false,
      offline: false,
      edits: 0,
      timer: setInterval(() => {
        try {
          policy(world)
        } catch {
          // The store is being replaced (a restart); the next tick decides.
        }
      }, 10),
    }
    await quiet(world.engine)
    gate(world)
    return world
  },
  stop: async (world) => {
    clearInterval(world.timer)
    const { fake, userData } = world.engine
    fake.gate(undefined)
    fake.releaseFramesWhere(() => true, true)
    if (!world.closed) await stopEngine(world)
    await fake.close()
    await rm(userData, { recursive: true, force: true })
  },
  own,
  perform,
  // The next try of a copy's delete waits out the backoff of every refused try before it: 32 s by the sixth.
  roundMs: (steps) => (steps.some((state) => ['deleteCopy', 'keepCopy'].includes(sOf(state).label)) ? 75_000 : undefined),
  expected: (states, index) => ({
    d1: expectedDraft(states, index, 1),
    d2: expectedDraft(states, index, 2),
    connected: sOf(states[index]!).connected,
  }),
  debug: (world) =>
    [
      `  gated: ${JSON.stringify(world.engine.fake.gated().map((call) => ({ id: call.id, method: call.method, stage: call.stage, outcome: call.outcome, ts: call.args['ts'], channel: call.args['channel'] })))}`,
      `  calls: ${world.engine.fake.calls
        .filter((call) => call.kind === 'api' && (isAction(call.method, call.args) || isPost(world, call.method, call.args) || isLookup(call.method, call.args)))
        .map((call) => `${call.method} ${call.args['channel']} ${call.args['ts'] ?? ''} ${call.ok ? 'ok' : call.error}`)
        .join(', ')}`,
      `  outbox: ${JSON.stringify(readDb(world.engine, 'user.db', (db) => db.prepare('SELECT kind, target_key, depends_on, payload_json, attempts, next_at, last_error FROM outbox').all()))}`,
    ].join('\n'),
  observe: (world) => ({
    d1: observeDraft(world, 1),
    d2: observeDraft(world, 2),
    connected: !world.closed && world.engine.fake.socketCount() > 0,
  }),
}

