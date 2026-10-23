// Shared by the outbox action tests (`actions.test.ts`, `reactions.test.ts`):
// one engine per test, warm on a copy of the synced default workspace, #eng's
// Main window, and readers of Slack's and the store's state.
import { afterEach } from 'bun:test'
import type { MessageRef, MessageView } from '@juno/contract'
import { messagesAtom, sendMessage, type ListWindow } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine, quiet, readDb, restart, valueOf } from './scenario'
import { syncedEngine, type SyncedOptions } from './synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
/** Stops this file's engines after each test. Call once at the top of a test file. */
export const stopEnginesAfterEach = () =>
  afterEach(async () => {
    for (const unmount of unmounts.splice(0)) unmount()
    for (const engine of engines.splice(0).toReversed()) await engine.stop()
  })

/** Unmounts the windows and starts a new engine on `first`'s directory and fake (`scenario` `restart`). */
export const restarted = (first: RunningEngine, whileStopped: Parameters<typeof restart>[2]) => {
  for (const unmount of unmounts.splice(0)) unmount()
  return restart(engines, first, whileStopped)
}

export const MAIN = 'm:C0ENG'
export const eng = { kind: 'channel', channelId: 'C0ENG' } as const

/** An engine live on the default seed, warm on the synced workspace; `firstSync` cold-boots instead, for a test of state only the first sync leaves. */
export const booted = async ({ firstSync = false, ...options }: SyncedOptions & { readonly firstSync?: boolean } = {}) => {
  const engine = firstSync ? await bootedEngine(engines, options) : await syncedEngine(engines, options)
  await quiet(engine)
  engine.fake.resetCalls()
  return engine
}

export type Rows = ReadonlyArray<MessageView>

/** The topic's message window, mounted, read until `predicate` holds. */
export function watch(engine: RunningEngine, topicId: string) {
  const atom = messagesAtom(topicId)
  unmounts.push(engine.registry.mount(atom))
  const current = (): ListWindow<MessageView> | undefined => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
  }
  return (predicate: (rows: Rows) => boolean, label: string) =>
    waitFor(() => {
      const window = current()
      const rows = window?.order.map((id) => window.rows.get(id)!)
      return rows !== undefined && predicate(rows) ? rows : undefined
    }, WAIT_MS, label)
}

export const textOf = (row: MessageView) =>
  row.body.blocks
    .flatMap((block) => ('children' in block ? block.children : []))
    .map((inline) => ('text' in inline ? inline.text : ''))
    .join('')

export const rowWith = (rows: Rows, text: string) => rows.find((row) => textOf(row) === text)
export const refOf = (row: MessageView): MessageRef => ({ channelId: 'C0ENG', ts: row.ts, ...(row.clientMsgId === undefined ? {} : { clientMsgId: row.clientMsgId }) })

/** Sends `text` to #eng's Main and waits until Slack's message is stored. */
export async function sent(engine: RunningEngine, text: string, rows: ReturnType<typeof watch>): Promise<MessageView> {
  valueOf(await sendMessage(engine.registry, eng, text, MAIN))
  const list = await rows((shown) => rowWith(shown, text)?.pending === undefined && rowWith(shown, text) !== undefined, `"${text}" stored`)
  return rowWith(list, text)!
}

export const inSlack = (engine: RunningEngine, ts: string) => engine.fake.messages('C0ENG').find((m) => m.ts === ts)
export const actionRows = (engine: RunningEngine) => readDb(engine, 'user.db', (db) => db.prepare(`SELECT kind FROM outbox WHERE kind IN ('edit', 'delete', 'react')`).all() as Array<{ kind: string }>)
export const chip = (row: MessageView | undefined, name: string) => row?.reactions.find((reaction) => reaction.name === name)

