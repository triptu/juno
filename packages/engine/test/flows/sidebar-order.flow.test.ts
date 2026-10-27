// The sidebar's order against the fake Slack (SPEC 5, "Holding the order"): an own send moves its topic
// to the top before Slack answers, from Main and from a thread under the pointer, and a live reply or DM
// moves its row while a sync cycle runs. The first window that shows the new words has the row on top:
// the move never lags the content. An own send undone during a cycle (refused, deleted) moves its row
// back, and rows a cycle kept in place take their true order once it ends, sliding as changes from
// elsewhere do even when the last write was the user's. The minute's run never sends a list older than
// one already sent.
import { afterEach, expect, it } from 'bun:test'
import { topicsRename } from '@juno/contract'
import {
  defaultTopicListFilter,
  deleteMessage,
  engineStatusAtom,
  loadSidebarMoves,
  runCommand,
  sendMessage,
  setSidebarEngaged,
  sidebarFilterAtom,
  sidebarListAtom,
  sidebarSectionsAtom,
  type SidebarWindow,
} from '@juno/state'
import { controlledSleep } from '../controlledClock'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { readDb, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** The engine's start and whether the page sees a sync cycle running. */
const engineStatus = (engine: RunningEngine) => {
  const status = engine.registry.get(engineStatusAtom)
  return status._tag === 'Success' ? status.value : undefined
}

/** A reconnect whose catch-up waits on its counts, so a cycle runs while the socket is live, until `client.counts` is released. */
async function heldCatchUp(engine: RunningEngine): Promise<void> {
  const { fake } = engine
  fake.holdNext({ method: 'client.counts' })
  fake.dropSocket()
  await waitFor(() => (fake.heldCount({ method: 'client.counts' }) === 1 && fake.socketCount() === 1) || undefined, WAIT_MS, 'the catch-up waiting on its counts')
  await waitFor(() => engineStatus(engine)?.syncing || undefined, WAIT_MS, 'the sidebar seeing the sync cycle')
}

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
    await heldCatchUp(engine)

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

it('during a catch-up an own send that is refused or deleted moves its row back, and kept rows take their true order when it ends', async () => {
  const engine = await syncedEngine(engines)
  const { registry, fake } = engine
  registry.set(sidebarFilterAtom, defaultTopicListFilter)
  const { shown } = watchList(engine)
  await shown()
  const recent = () => registry.get(sidebarSectionsAtom).recent
  const row = (id: string) => registry.get(sidebarListAtom).rows.get(id)
  const lowest = (prefix: string) => recent().findLast((id) => id.startsWith(prefix) && id !== recent()[0])!
  const pending = (text: string) => readDb(engine, 'user.db', (db) =>
    db.prepare('SELECT client_msg_id AS id, state FROM pending_messages WHERE text = ?').get(text) as { id: string; state: string } | undefined)
  await heldCatchUp(engine)

  await step('a send Slack refuses leaves its row where it was, with its last message', async () => {
    const id = lowest('m:C')
    const before = recent()
    const preview = row(id)!.preview.text
    fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 1 })
    valueOf(await sendMessage(registry, { kind: 'channel', channelId: id.slice(2) }, 'This one is refused'))
    await waitFor(() => pending('This one is refused')?.state === 'failed' || undefined, WAIT_MS, 'the refused post')
    await waitFor(() => row(id)?.preview.text === preview || undefined, WAIT_MS, 'the last message back in the row')
    expect(recent()).toEqual(before)
  })

  await step('a reply deleted before Slack has it moves its thread back', async () => {
    const thread = lowest('t:')
    const [, channel, threadTs] = thread.split(':') as [string, string, string]
    const main = `m:${channel}`
    const before = recent().filter((id) => id !== main)
    // The channel's first post waits on Slack, so the reply stays queued behind it and can be deleted.
    fake.holdNext({ method: 'chat.postMessage', before: true })
    valueOf(await sendMessage(registry, { kind: 'channel', channelId: channel }, 'Holding the channel'))
    valueOf(await sendMessage(registry, { kind: 'channel', channelId: channel, threadTs }, 'Taking this back'))
    // Both posts can be queued in one millisecond, so the thread and its channel's Main may tie at the top.
    await waitFor(() => recent().filter((id) => id !== main)[0] === thread || undefined, WAIT_MS, 'the reply moving its thread up')
    const reply = pending('Taking this back')!
    expect(reply.state).toBe('queued')
    valueOf(await deleteMessage(registry, { channelId: channel, ts: `pending:${reply.id}`, clientMsgId: reply.id }))
    await waitFor(() => row(thread)?.preview.text !== 'Taking this back' || undefined, WAIT_MS, 'the reply gone from the row')
    expect(recent().filter((id) => id !== main)).toEqual(before)
    fake.release({ method: 'chat.postMessage' })
    // The held post stored: its row has its Slack time, so nothing moves under the next step.
    await waitFor(() => {
      const posted = fake.messages(channel).find((m) => m.text === 'Holding the channel')
      return (posted !== undefined && pending('Holding the channel') === undefined && row(main)?.lastActivityTs === posted.ts) || undefined
    }, WAIT_MS, 'the held post stored')
  })

  await step('activity from before the launch keeps its row in place during the catch-up, and the rows slide to their true order when it ends, after a rename of yours', async () => {
    await loadSidebarMoves()
    const id = lowest('m:C')
    const before = recent()
    // Dated a minute before the engine started: newer than the rows above it, but not live.
    fake.workspace.post({ channel: id.slice(2), user: 'U0LEO', text: 'Written before the launch', at: engineStatus(engine)!.startedAt - 60_000 })
    await waitFor(() => row(id)?.preview.text === 'Written before the launch' || undefined, WAIT_MS, 'the message in the row')
    expect(recent()).toEqual(before)
    // Your rename is the last write before the catch-up ends; it moves no row.
    const renamed = recent().find((other) => other.startsWith('t:'))!
    valueOf(await runCommand(registry, topicsRename, { id: renamed, title: 'Renamed during the catch-up' }))
    await waitFor(() => row(renamed)?.title === 'Renamed during the catch-up' || undefined, WAIT_MS, 'the rename in the row')
    expect(recent()).toEqual(before)
    const changes: Array<{ readonly recent: ReadonlyArray<string>; readonly moves: string }> = []
    unmounts.push(registry.subscribe(sidebarSectionsAtom, (sections) => changes.push({ recent: sections.recent, moves: sections.moves })))
    fake.release({ method: 'client.counts' })
    await waitFor(() => (engineStatus(engine)?.syncing === false) || undefined, WAIT_MS, 'the sidebar seeing the catch-up end')
    const activity = recent().map((other) => row(other)!.lastActivityAt)
    expect(activity).toEqual(activity.toSorted((a, b) => b - a))
    // The rows the catch-up held move as changes from elsewhere do: they slide (SPEC 5, "Letting go").
    expect(changes.find((change) => change.recent.indexOf(id) < before.indexOf(id))?.moves).toBe('animate')
  })
})

it('a run the minute asks for while a change is being read never sends the list from before that change', async () => {
  const minute = await controlledSleep(60_000)
  try {
    const engine = await syncedEngine(engines, { clock: minute.clock })
    const { registry } = engine
    const atom = engine.topicsAtom()
    const first = await engine.topics()
    const id = first.order.find((other) => other.startsWith('t:'))!
    const titles: Array<string | undefined> = []
    unmounts.push(registry.subscribe(atom, (result) => { if (result._tag === 'Success') titles.push(result.value.rows.get(id)?.title) }))
    const rename = async (title: string) => valueOf(await runCommand(registry, topicsRename, { id, title }))

    // The run for the first rename has read it and waits; the second rename and the minute land meanwhile.
    const held = engine.holdLiveRead('topics.list')
    await rename('First name')
    await held.reached
    await rename('Second name')
    await minute.fire()
    await waitFor(() => engine.liveTicks('topics.list') > 0 || undefined, WAIT_MS, 'the minute asking for a run')
    held.release()

    // Both names are sent and the second is the last; once it is shown, it stays.
    await waitFor(() => (titles.includes('First name') && titles.at(-1) === 'Second name') || undefined, WAIT_MS, 'both names sent, the second last')
    expect(titles.slice(titles.indexOf('Second name'))).toEqual(['Second name'])
  } finally {
    for (const engine of engines.splice(0).toReversed()) await engine.stop()
    await minute.close()
  }
})
