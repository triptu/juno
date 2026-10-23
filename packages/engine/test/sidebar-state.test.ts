// The sidebar's renderer state against the real engine: what the list
// container and its rows would see while the user changes filters
// (performance 5.3: old rows stay, the new window replaces them in one step,
// unchanged rows keep their objects).
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  activateTab,
  loadSidebarMoves,
  runCommand,
  sendMessage,
  releaseSidebarTopic,
  openSidebarSheet,
  closeSidebarSheet,
  openPlace,
  topicPlace,
  updateTabs,
  currentRowAtom,
  defaultTopicListFilter,
  selectedTopicAtom,
  sidebarFilterAtom,
  sidebarListAtom,
  sidebarRowAtom,
  sidebarSectionsAtom,
  type SidebarWindow,
} from '@juno/state'
import { topicsResolve, type TopicRow } from '@juno/contract'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, quiet } from './scenario'

// Titles are the first words of the root message.
const POSTGRES = 'Draft plan is in the doc'
const ROADMAP = 'Proposal: cut offline mode and public'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0)) await engine.stop()
})

async function liveEngine(): Promise<RunningEngine> {
  const engine = await startTestEngine({ initial: (fake) => fake.signIn() })
  engines.push(engine)
  await engine.status('ready')
  await engine.phase('live')
  return engine
}

/** Mounts the shown window the way the list container does, and records every value it takes. */
function watchList(engine: RunningEngine) {
  const { registry } = engine
  const seen: Array<SidebarWindow> = []
  unmounts.push(registry.mount(sidebarListAtom), registry.mount(sidebarSectionsAtom), registry.subscribe(sidebarListAtom, (window) => seen.push(window)))
  const shown = (kind: string) =>
    waitFor(
      () => {
        const window = registry.get(sidebarListAtom)
        return window.filter.kind === kind && window.order.length > 0 ? window : undefined
      },
      undefined,
      `the ${kind} window`,
    )
  return { seen, shown }
}

describe('the sidebar list across filter changes', () => {
  it('keeps the old rows until the new window arrives, never shows an empty list, and keeps unchanged rows as the same objects', async () => {
    const engine = await liveEngine()
    const { registry } = engine
    registry.set(sidebarFilterAtom, defaultTopicListFilter)
    const { seen, shown } = watchList(engine)
    const all = await shown('all')
    const shared = all.order.find((id) => all.rows.get(id)!.channel.kind === 'public')!
    let sharedNotified = 0
    const stopRow = registry.subscribe(sidebarRowAtom(shared), () => sharedNotified++)
    seen.length = 0

    registry.set(sidebarFilterAtom, { kind: 'channels', unreadOnly: false })
    // The Channels window is not in yet: the All rows stay, under their own filter.
    expect(registry.get(sidebarListAtom).filter.kind).toBe('all')
    expect(registry.get(sidebarSectionsAtom).ready).toBe(true)

    const channels = await shown('channels')
    stopRow()
    expect(seen.every((window) => window.order.length > 0)).toBe(true)
    // One step from All to Channels: no value in between.
    expect(seen.filter((window) => window.filter.kind === 'channels').length).toBeGreaterThan(0)
    expect(channels.order.every((id) => all.rows.get(id) === undefined || channels.rows.get(id)!.channel.kind !== 'im')).toBe(true)
    // A row in both windows with the same rev is the same object, so its row atom did not notify.
    expect(channels.rows.get(shared)).toBe(all.rows.get(shared))
    expect(sharedNotified).toBe(0)
    const sameRev = channels.order.filter((id) => all.rows.get(id)?.rev === channels.rows.get(id)!.rev)
    expect(sameRev.length).toBeGreaterThan(0)
    for (const id of sameRev) expect(channels.rows.get(id)).toBe(all.rows.get(id))

    // Back to All while its subscription is still warm (idle TTL): the swap is immediate.
    registry.set(sidebarFilterAtom, defaultTopicListFilter)
    const back = registry.get(sidebarListAtom)
    expect(back.filter.kind).toBe('all')
    expect(back.rows.get(shared)).toBe(all.rows.get(shared))
  })

  it('keeps the same sidebar window when switching tabs with nothing retained', async () => {
    const engine = await liveEngine()
    const { registry } = engine
    const { shown } = watchList(engine)
    const all = await shown('all')
    const [first, second] = all.order
    const tabs = updateTabs(registry, (current) =>
      openPlace(openPlace(current, topicPlace(first!)), topicPlace(second!), { newTab: true }),
    )
    const before = registry.get(sidebarListAtom)
    expect(before.retained?.size ?? 0).toBe(0)

    const switched = updateTabs(registry, (current) => activateTab(current, tabs.tabs[0]!.id))
    expect(switched.active).not.toBe(tabs.active)
    expect(registry.get(sidebarListAtom)).toBe(before)
  })

  it('marks one row tabbable: the first, or the selection while it is shown', async () => {
    const engine = await liveEngine()
    const { registry } = engine
    registry.set(sidebarFilterAtom, defaultTopicListFilter)
    registry.set(selectedTopicAtom, undefined)
    const { shown } = watchList(engine)
    const all = await shown('all')
    const [first, second] = all.order
    const stops = [registry.mount(currentRowAtom(first!)), registry.mount(currentRowAtom(second!))]
    expect(registry.get(currentRowAtom(first!))).toBe(true)
    expect(registry.get(currentRowAtom(second!))).toBe(false)

    registry.set(selectedTopicAtom, second)
    expect(registry.get(currentRowAtom(first!))).toBe(false)
    expect(registry.get(currentRowAtom(second!))).toBe(true)

    // A selection that is not in the window falls back to the first row.
    registry.set(selectedTopicAtom, 't:C0NOWHERE:1.000000')
    expect(registry.get(currentRowAtom(first!))).toBe(true)
    stops.forEach((stop) => stop())
    registry.set(selectedTopicAtom, undefined)
  })
})

describe('the sidebar rows across a profile change', () => {
  it('a renamed person reaches every row that names them, though the query keeps the users it has read', async () => {
    const engine = await liveEngine()
    const before = await engine.rowsUntil((rows) => rows.some((r) => r.participants.some((p) => p.id === 'U0LEO')), 'a row with Leo')
    const named = before.filter((r) => r.participants.some((p) => p.id === 'U0LEO')).map((r) => r.id)
    const leo = engine.fake.workspace.users.get('U0LEO')!
    engine.fake.emitFrame({ type: 'user_change', user: { ...leo, profile: { ...leo.profile, display_name: 'Leonard', real_name: 'Leonard Park' } }, event_ts: '1.000001' })
    const after = await engine.rowsUntil(
      (rows) => named.every((id) => rows.find((r) => r.id === id)?.participants.find((p) => p.id === 'U0LEO')?.name === 'Leonard'),
      'Leo renamed on every row',
    )
    expect(after.filter((r) => r.participants.some((p) => p.name === 'Leo')).map((r) => r.id)).toEqual([])
  })
})

describe('the participant stack on a busy thread', () => {
  it('shows four unread senders other than you, most recent first, and counts the rest', async () => {
    const engine = await liveEngine()
    const { fake } = engine
    const root = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Who can review the cutover runbook?' })
    // Your reply reads the thread up to it, so the root is read; the five replies after it are not.
    for (const user of ['U0TUSHAR', 'U0LEO', 'U0SAM', 'U0PRIYA', 'U0JONAS', 'U0DEV']) {
      fake.injectMessage({ channel: 'C0ENG', user, threadTs: root.ts, text: 'I can take a section.' })
    }
    fake.followThread({ channel: 'C0ENG', threadTs: root.ts })
    const id = `t:C0ENG:${root.ts}`
    // Four people show while the replies are still arriving, so wait for the stack after the last one.
    const stack = (all: ReadonlyArray<TopicRow>) => all.find((r) => r.id === id)?.participants.map((p) => p.id).join()
    const rows = await engine.rowsUntil((all) => stack(all) === 'U0DEV,U0JONAS,U0PRIYA,U0SAM', 'the busy thread with four people')
    const row = rows.find((r) => r.id === id)!
    expect(row.participants.map((p) => p.id)).toEqual(['U0DEV', 'U0JONAS', 'U0PRIYA', 'U0SAM'])
    // Leo is the fifth unread sender; Maya's root came before your reply, so it is read.
    expect(row.moreParticipants).toBe(1)
  })
})

describe('a store indexed by an older Juno', () => {
  it('takes the unread senders from local messages on launch, with no history calls', async () => {
    const first = await bootedEngine(engines)
    const rows = await first.rowsUntil((all) => all.some((r) => r.title.startsWith(ROADMAP)), 'the roadmap thread')
    const roadmap = rows.find((r) => r.title.startsWith(ROADMAP))!
    const postgres = rows.find((r) => r.title.startsWith(POSTGRES))!
    expect(roadmap.unreadCount).toBeGreaterThan(0)
    expect(postgres.unreadCount).toBe(0)
    const senders = roadmap.participants.map((p) => p.id)
    expect(senders.length).toBeGreaterThan(0)

    const { fake, userData } = first
    const credentials = fake.credentials()
    await quiet(first)
    first.registry.dispose()
    await first.handle.stop()
    engines.splice(engines.indexOf(first), 1)
    // As an older Juno left it: the latest senders on every row, read or not, and no index version.
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'))
    db.prepare('UPDATE topic_index SET participants_json = ? WHERE topic_id = ?').run('["U0DEV","U0LEO"]', postgres.id)
    db.prepare('UPDATE topic_index SET participants_json = ? WHERE topic_id = ?').run('[]', roadmap.id)
    db.prepare("DELETE FROM sync_state WHERE key = 'index-version'").run()
    db.close()

    fake.resetCalls()
    // The boot waits on Slack, so only the local upgrade can change the rows.
    fake.holdNext({ method: 'client.userBoot', before: true })
    fake.holdNext({ method: 'client.counts', before: true })
    const second = await startTestEngine({ reuse: { userData, fake, credentials }, initial: () => credentials, recheckTopics: 0 })
    engines.push({ ...second, stop: async () => { await second.stop(); await fake.close(); await rm(userData, { recursive: true, force: true }) } })
    const after = await second.rowsUntil((all) => {
      const people = (title: string) => all.find((r) => r.title.startsWith(title))?.participants.map((p) => p.id).join()
      return people(POSTGRES) === '' && people(ROADMAP) === senders.join()
    }, 'the rows re-indexed')
    expect(after.find((r) => r.title.startsWith(POSTGRES))!.participants).toEqual([])
    expect(apiCalls(second, 'conversations.history')).toEqual([])
    expect(apiCalls(second, 'conversations.replies')).toEqual([])
    fake.release()
  })
})

it('marks command changes as instant without suppressing the next outside arrival', async () => {
  const engine = await bootedEngine(engines)
  const { registry, fake } = engine
  await loadSidebarMoves()
  const { shown } = watchList(engine)
  await shown('all')
  const first = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Review motion provenance' })
  fake.followThread({ channel: 'C0ENG', threadTs: first.ts })
  const id = `t:C0ENG:${first.ts}`
  await waitFor(() => registry.get(sidebarSectionsAtom).recent.includes(id) || undefined)
  expect(registry.get(sidebarSectionsAtom).moves).toBe('animate')

  releaseSidebarTopic(registry, id)
  const resolved = await runCommand(registry, topicsResolve, { id })
  expect(resolved._tag).toBe('Success')
  await waitFor(() => !registry.get(sidebarSectionsAtom).recent.includes(id) || undefined)
  expect(registry.get(sidebarSectionsAtom).moves).toBe('instant')

  // No 1.5-second pause: a real reply immediately after Resolve is a new outside change.
  fake.injectMessage({ channel: 'C0ENG', threadTs: first.ts, user: 'U0LEO', text: 'An outside reply reopens it' })
  await waitFor(() => registry.get(sidebarSectionsAtom).recent[0] === id || undefined)
  expect(registry.get(sidebarSectionsAtom).moves).toBe('animate')

  // A sheet that changed nothing must not consume the next outside reorder.
  openSidebarSheet(registry)
  closeSidebarSheet(registry)
  const next = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'The next independent topic' })
  fake.followThread({ channel: 'C0ENG', threadTs: next.ts })
  const nextId = `t:C0ENG:${next.ts}`
  await waitFor(() => registry.get(sidebarSectionsAtom).recent.includes(nextId) || undefined)
  expect(registry.get(sidebarSectionsAtom).moves).toBe('animate')
})


it('keeps a delayed own send instant while an unrelated reply can move during the wait', async () => {
  const engine = await bootedEngine(engines)
  const { registry, fake } = engine
  await loadSidebarMoves()
  const { shown } = watchList(engine)
  const initial = await shown('all')
  const id = initial.order.filter((key) => key.startsWith('t:')).at(-1)!
  const [, channel, threadTs] = id.split(':')
  fake.holdNext({ method: 'conversations.open', before: true })
  const sending = sendMessage(registry, { kind: 'person', userId: 'U0JONAS' }, 'A delayed own send')
  await waitFor(() => fake.heldCount({ method: 'conversations.open' }) > 0 || undefined)
  fake.injectMessage({ channel: channel!, threadTs: threadTs!, user: 'U0LEO', text: 'An independent reply during the command' })
  await waitFor(() => registry.get(sidebarSectionsAtom).recent[0] === id || undefined)
  expect(registry.get(sidebarSectionsAtom).moves).toBe('animate')
  await new Promise((done) => setTimeout(done, 1_600))
  fake.release()
  const exit = await sending
  expect(exit._tag).toBe('Success')
  if (exit._tag !== 'Success') return
  await waitFor(() => registry.get(sidebarListAtom).rows.get(exit.value.topicId)?.preview.text === 'A delayed own send' || undefined)
  expect(registry.get(sidebarSectionsAtom).moves).toBe('instant')
})
