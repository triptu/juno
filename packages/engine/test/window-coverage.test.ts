// A topic window learns that history covers it from `synced_ranges`. The
// `messages.list` subscription listens on `{ synced_ranges: [channel] }` for
// that, so a history page that adds a range but no new or changed message
// must still move the window to covered, without the renderer asking again.
import { afterEach, expect, it } from 'vitest'
import type { MessageView } from '@juno/contract'
import { messagesAtom, openTopic, type ListWindow } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine, quiet, readDb, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function watchList(engine: RunningEngine, id: string) {
  const atom = messagesAtom(id)
  unmounts.push(engine.registry.mount(atom))
  return (predicate: (window: ListWindow<MessageView>) => boolean, label: string) =>
    waitFor(() => {
      const result = engine.registry.get(atom)
      const window = result._tag === 'Success' && result.value.meta.seq > 0 ? result.value : undefined
      return window !== undefined && predicate(window) ? window : undefined
    }, WAIT_MS, label)
}

it('marks a Main window covered when its first history page brings nothing new', async () => {
  const engine = await bootedEngine(engines, {
    initial: (fake) => {
      // No message in the window, so the boot reads no history for it and it has no synced range.
      fake.addChannel({ id: 'C0QUIET', name: 'quiet', messages: [] })
      return fake.signIn()
    },
  })
  await quiet(engine)
  const until = watchList(engine, 'm:C0QUIET')
  // Stored from the socket only: the window has a row but no history range.
  const message = engine.fake.injectMessage({ channel: 'C0QUIET', user: 'U0MAYA', text: 'Only seen on the socket' })
  await until((window) => window.rows.has(message.ts) && window.meta.windowCovered === false, 'the socket message, not yet covered')

  // The page returns the same one message, so nothing in `messages` changes; only the range is added.
  expect(valueOf(await openTopic(engine.registry, 'm:C0QUIET')).outcome).toBe('fetched')
  const ranges = readDb(engine, 'cache.db', (db) => db.prepare('SELECT count(*) AS n FROM synced_ranges WHERE channel = ?').get('C0QUIET') as { n: number })
  expect(ranges.n).toBe(1)
  await until((window) => window.meta.windowCovered === true, 'the window covered by the new range')
})

it('marks a thread window covered when the replies page changes only coverage', async () => {
  const engine = await bootedEngine(engines)
  await quiet(engine)
  const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Thread with incomplete counters' })
  engine.fake.emitFrame({ type: 'message', subtype: 'message_replied', channel: 'C0ENG', message: { ts: root.ts, reply_count: 10 }, event_ts: root.ts })
  const id = `t:C0ENG:${root.ts}`
  const until = watchList(engine, id)
  await until((window) => window.rows.has(root.ts) && window.meta.windowCovered === false, 'thread without coverage')
  const version = () => readDb(engine, 'cache.db', (db) => db.prepare('SELECT version FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', root.ts))
  const before = version()
  expect(valueOf(await openTopic(engine.registry, id)).outcome).toBe('fetched')
  expect(version()).toEqual(before)
  await until((window) => window.meta.windowCovered === true, 'thread covered by unchanged replies page')
})
