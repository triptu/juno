// The sidebar's order against the fake Slack (SPEC 5, "Holding the order"): an own send moves its topic
// to the top before Slack answers, from Main and from a thread under the pointer, and a live reply or DM
// moves its row while a sync cycle runs. The first window that shows the new words has the row on top:
// the move never lags the content.
import { afterEach, expect, it } from 'bun:test'
import {
  defaultTopicListFilter,
  engineStatusAtom,
  sendMessage,
  setSidebarEngaged,
  sidebarFilterAtom,
  sidebarListAtom,
  sidebarSectionsAtom,
  type SidebarWindow,
} from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** Mounts the shown window the way the list container does, and records every value it takes. */
function watchList(engine: RunningEngine) {
  const { registry } = engine
  const seen: Array<SidebarWindow> = []
  unmounts.push(registry.mount(sidebarListAtom), registry.mount(sidebarSectionsAtom), registry.subscribe(sidebarListAtom, (window) => seen.push(window)))
  const shown = () => waitFor(() => (registry.get(sidebarListAtom).order.length > 0 ? true : undefined), WAIT_MS, 'the All window')
  return { seen, shown }
}

it('an own send moves its topic to the top before Slack answers, and live messages move theirs while a sync cycle runs', async () => {
  const engine = await syncedEngine(engines)
  const { registry, fake } = engine
  registry.set(sidebarFilterAtom, defaultTopicListFilter)
  const { seen, shown } = watchList(engine)
  await shown()
  const recent = () => registry.get(sidebarSectionsAtom).recent
  /** The lowest row in Recent of this kind, so a move to the top is a move. */
  const lowest = (prefix: string) => recent().findLast((id) => id.startsWith(prefix) && id !== recent()[0])!
  /**
   * The first window that shows `text` in the row's preview: its row is first then, in the same window, never
   * one later (SPEC 5, "Your own actions apply at once"; changes from elsewhere apply live).
   */
  const topWhenShown = async (id: string, text: string, label: string) => {
    const found = await waitFor(() => seen.find((window) => window.rows.get(id)?.preview.text === text), WAIT_MS, label)
    expect(found.order.filter((other) => found.rows.get(other)!.section === 'recent')[0]).toBe(id)
  }

  await step('a send in Main moves its row to the top, with the words, while Slack has not answered', async () => {
    const id = lowest('m:C')
    const channel = id.slice(2)
    fake.holdNext({ method: 'chat.postMessage', before: true })
    seen.length = 0
    valueOf(await sendMessage(registry, { kind: 'channel', channelId: channel }, 'Moving this up myself'))
    await topWhenShown(id, 'Moving this up myself', 'the sent words in the row')
    expect(registry.get(sidebarListAtom).rows.get(id)!.preview.sender).toBe('You')
    // The hold kept Slack from answering until now.
    fake.release({ method: 'chat.postMessage' })
    await waitFor(() => fake.messages(channel).some((m) => m.text === 'Moving this up myself') || undefined, WAIT_MS, 'the post in Slack')
    await engine.rowsUntil((rows) => rows.find((r) => r.id === id)?.preview.text === 'Moving this up myself', 'the stored message in the row')
    expect(recent()[0]).toBe(id)
  })

  await step('a reply sent from a thread under the pointer moves the thread to the top while Slack has not answered', async () => {
    const id = lowest('t:')
    const [, channel, threadTs] = id.split(':') as [string, string, string]
    setSidebarEngaged(registry, true)
    fake.holdNext({ method: 'chat.postMessage', before: true })
    seen.length = 0
    valueOf(await sendMessage(registry, { kind: 'channel', channelId: channel, threadTs }, 'Replying from the thread'))
    await topWhenShown(id, 'Replying from the thread', 'the reply in the thread row')
    fake.release({ method: 'chat.postMessage' })
    setSidebarEngaged(registry, false)
    await waitFor(() => fake.messages(channel).some((m) => m.text === 'Replying from the thread') || undefined, WAIT_MS, 'the reply in Slack')
  })

  await step('while a catch-up runs, a reply from someone else and a DM move their rows at once', async () => {
    // The catch-up after a reconnect waits on its counts, so the cycle runs while the socket is live.
    fake.holdNext({ method: 'client.counts' })
    fake.dropSocket()
    await waitFor(() => (fake.heldCount({ method: 'client.counts' }) === 1 && fake.socketCount() === 1) || undefined, WAIT_MS, 'the catch-up waiting on its counts')
    await waitFor(() => {
      const status = registry.get(engineStatusAtom)
      return (status._tag === 'Success' && status.value.syncing) || undefined
    }, WAIT_MS, 'the sidebar seeing the sync cycle')

    const thread = lowest('t:')
    const [, channel, threadTs] = thread.split(':') as [string, string, string]
    seen.length = 0
    fake.injectMessage({ channel, threadTs, user: 'U0LEO', text: 'Sharing the numbers now' })
    await topWhenShown(thread, 'Sharing the numbers now', 'the reply in the thread row')

    const dm = lowest('m:D')
    seen.length = 0
    fake.injectMessage({ channel: dm.slice(2), user: registry.get(sidebarListAtom).rows.get(dm)!.channel.partner!.id, text: 'Got a minute?' })
    await topWhenShown(dm, 'Got a minute?', 'the DM row')
    expect(engine.syncing()).toBe(true)
    fake.release({ method: 'client.counts' })
    await engine.syncIdle()
  })
})
