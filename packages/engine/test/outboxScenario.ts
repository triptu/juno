// Shared by the outbox flows (`flows/outbox*.flow.test.ts`) and
// `who-reacted.test.ts`: one engine per test, warm on a copy of the synced default workspace, #eng's
// Main window, and readers of Slack's state. `outboxScenario()` keeps each file's engines to itself.
import { afterEach, expect } from 'bun:test'
import type { MessageRef, MessageView } from '@juno/contract'
import { messagesAtom, sendMessage, type ListWindow } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, quiet, readDb, restart, valueOf } from './scenario'
import { syncedEngine, type SyncedOptions } from './synced'

export const MAIN = 'm:C0ENG'
export const eng = { kind: 'channel', channelId: 'C0ENG' } as const

export type Rows = ReadonlyArray<MessageView>
export type Watch = (predicate: (rows: Rows) => boolean, label: string) => Promise<Rows>

/** Engines and mounted windows for one test file, stopped after each test. Call once at the top of the file. */
export function outboxScenario() {
  const engines: Array<RunningEngine> = []
  const unmounts: Array<() => void> = []
  afterEach(async () => {
    for (const unmount of unmounts.splice(0)) unmount()
    for (const engine of engines.splice(0).toReversed()) await engine.stop()
  })

  /** An engine live on the default seed, warm on the synced workspace; `firstSync` cold-boots instead, for state only the first sync leaves. */
  const booted = async ({ firstSync = false, ...options }: SyncedOptions & { readonly firstSync?: boolean } = {}) => {
    const engine = firstSync ? await bootedEngine(engines, options) : await syncedEngine(engines, options)
    await quiet(engine)
    engine.fake.resetCalls()
    return engine
  }

  /** The topic's message window, mounted, read until `predicate` holds. */
  const watch = (engine: RunningEngine, topicId: string): Watch => {
    const atom = messagesAtom(topicId)
    unmounts.push(engine.registry.mount(atom))
    const current = (): ListWindow<MessageView> | undefined => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
    }
    return (predicate, label) =>
      waitFor(() => {
        const window = current()
        const rows = window?.order.map((id) => window.rows.get(id)!)
        return rows !== undefined && predicate(rows) ? rows : undefined
      }, WAIT_MS, label)
  }

  /** `topicId`'s window, mounted once it shows rows. */
  const opened = async (engine: RunningEngine, topicId = MAIN) => {
    const rows = watch(engine, topicId)
    await rows((list) => list.length > 0, 'the window')
    return rows
  }

  /** Unmounts the windows and starts a new engine on `first`'s directory and fake (`scenario` `restart`). */
  const restarted = (first: RunningEngine, whileStopped?: Parameters<typeof restart>[2]) => {
    for (const unmount of unmounts.splice(0)) unmount()
    return restart(engines, first, whileStopped)
  }

  /** Unmounts the windows mounted so far, as closing the topic would. */
  const closeWindows = () => {
    for (const unmount of unmounts.splice(0)) unmount()
  }

  /** Stops an engine before the test ends (for a test that owns a controlled clock). */
  const stop = async (engine: RunningEngine) => {
    engines.splice(engines.indexOf(engine), 1)
    await engine.stop()
  }

  return { booted, watch, opened, restarted, closeWindows, stop }
}

export const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

export const rowWith = (rows: Rows, text: string) => rows.find((row) => textOf(row) === text)
export const refOf = (row: MessageView): MessageRef => ({ channelId: 'C0ENG', ts: row.ts, ...(row.clientMsgId === undefined ? {} : { clientMsgId: row.clientMsgId }) })
export const chip = (row: MessageView | undefined, name: string) => row?.reactions.find((reaction) => reaction.name === name)

/** The window shows the message once, as Slack's, and nothing pending. */
export const settled = (text: string) => (rows: Rows) =>
  rows.filter((row) => textOf(row) === text).length === 1 && rows.some((row) => textOf(row) === text && row.pending === undefined)

/** Sends `text` to #eng's Main and waits until Slack's message is shown. */
export async function sent(engine: RunningEngine, text: string, rows: Watch): Promise<MessageView> {
  valueOf(await sendMessage(engine.registry, eng, text, MAIN))
  return rowWith(await rows(settled(text), `"${text}" stored`), text)!
}

/** Sends `text` to #eng's Main and answers with its `client_msg_id`, from the pending row. */
export async function send(engine: RunningEngine, text: string, rows: Watch): Promise<string> {
  expect(valueOf(await sendMessage(engine.registry, eng, text, MAIN))).toEqual({ topicId: MAIN })
  const shown = await rows((list) => list.some((row) => row.pending !== undefined && textOf(row) === text), `"${text}" shown`)
  return rowWith(shown, text)!.clientMsgId!
}

/** Sends `text` to #eng's Main and answers with the `client_msg_id` of the post that went to Slack, for a post nothing holds. */
export async function post(engine: RunningEngine, text: string): Promise<string> {
  const before = apiCalls(engine, 'chat.postMessage').length
  expect(valueOf(await sendMessage(engine.registry, eng, text, MAIN))).toEqual({ topicId: MAIN })
  return waitFor(() => apiCalls(engine, 'chat.postMessage')[before]?.args['client_msg_id'], WAIT_MS, `"${text}" posted`)
}

/** Sends `text` to #eng's Main with Slack holding the post, and answers its row once shown as sending. */
export async function sending(engine: RunningEngine, rows: Watch, text: string): Promise<MessageView> {
  engine.fake.holdNext({ method: 'chat.postMessage', before: true })
  valueOf(await sendMessage(engine.registry, eng, text, MAIN))
  return rowWith(await rows((list) => rowWith(list, text)?.pending === 'sending', `"${text}" sending`), text)!
}

/** Starts a step with no calls recorded and nothing in flight. */
export const fresh = async (engine: RunningEngine) => {
  await quiet(engine)
  engine.fake.resetCalls()
}

/** #eng's message at `ts` in Slack. */
export const inSlack = (engine: RunningEngine, ts: string) => engine.fake.messages('C0ENG').find((m) => m.ts === ts)
/** Copies of a post in Slack's #eng. */
export const copies = (engine: RunningEngine, clientMsgId: string) => engine.fake.messages('C0ENG').filter((m) => m.client_msg_id === clientMsgId).length

/** Edits, deletes and reactions still in the outbox: the barrier for "the action has ended", since a retry may be due later. */
export const actionRows = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare(`SELECT kind FROM outbox WHERE kind IN ('edit', 'delete', 'react')`).all() as Array<{ kind: string }>)
export const actionsEnded = (engine: RunningEngine, label = 'the actions ended') => waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, label)
