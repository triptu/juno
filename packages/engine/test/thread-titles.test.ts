// Thread titles outside the sidebar: a Main's thread link and the channel's
// Threads list read the root's Slack text with entities decoded and the
// people it mentions named, never `<@U…>`.
import { afterEach, expect, it } from 'vitest'
import { channelThreadsAtom, messagesAtom, type ListWindow, type LiveListAtom } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine, quiet } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function watchList<Row, E>(engine: RunningEngine, atom: LiveListAtom<Row, E>) {
  unmounts.push(engine.registry.mount(atom))
  return (predicate: (window: ListWindow<Row>) => boolean, label: string) =>
    waitFor(() => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' && result.value.meta.seq > 0 && predicate(result.value) ? result.value : undefined
    }, WAIT_MS, label)
}

const rowsOf = <Row>(window: ListWindow<Row>) => window.order.map((id) => window.rows.get(id)!)

it('names the people a thread link and the Threads list mention, and decodes Slack escaping', async () => {
  const engine = await bootedEngine(engines)
  await quiet(engine)
  // As Slack stores it: `<@U0DEV> fix the backend -&gt; github sync today`.
  const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: '<@U0DEV> fix the backend -> github sync today' })
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0DEV', threadTs: root.ts, text: 'On it.' })
  const window = await watchList(engine, messagesAtom('m:C0ENG'))((current) => current.rows.get(root.ts)?.thread?.replyCount === 1, 'the thread link')
  expect(window.rows.get(root.ts)!.thread!.title).toBe('@Dev fix the backend -> github…')
  const listed = await watchList(engine, channelThreadsAtom('C0ENG'))((current) => rowsOf(current).some((row) => row.rootTs === root.ts), 'the thread in the list')
  expect(rowsOf(listed).find((row) => row.rootTs === root.ts)!.title).toBe('@Dev fix the backend -> github…')
})
