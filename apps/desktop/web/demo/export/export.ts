/**
 * The demo exporter (`docs/development.md`, "Demo"): runs the real engine
 * against the fake Slack seeded with the demo company (`demoSeed`), with
 * the fake AI and its background jobs so topics get titles and art, and
 * reads through the engine's own routes everything the read-only demo can
 * show. It writes `demo/snapshot.json`, which `@juno/state/demo` answers
 * the page from, and the files the snapshot names (avatars, images) beside
 * it, with every address rewritten to a relative one.
 *
 * Every topic the demo can reach (the sidebar's, each channel's switcher
 * and every thread link in a message) is opened and paged until both ends
 * are complete, then read whole and checked against the fake's messages, so
 * the demo never needs a page it does not have. Every person a message shows
 * is looked up, so a click on one answers. Nothing here waits a fixed time:
 * each step waits for the engine to say it is done.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { Logger, LogLevel, Schema } from 'effect'
import {
  aiActivity,
  channelThreads,
  presencePeople,
  notificationsSettings,
  notificationsStatus,
  huddleRunning,
  mentionsEmoji,
  uploadsProgress,
  engineStatus,
  messagesList,
  messagesLoadNewer,
  messagesLoadOlder,
  MESSAGE_WINDOW_MAX,
  peopleLocate,
  prefsGet,
  prefsSet,
  sessionProfile,
  sessionStatus,
  SIDEBAR_WINDOW,
  statusOf,
  THREADS_WINDOW_MAX,
  topicsCounts,
  topicsGet,
  topicsList,
  topicsOpen,
  viewsList,
  WorkspaceEmojiValue,
  type EngineStatus,
  type KindFilter,
  type MessageView,
  type Person,
} from '@juno/contract'
import { memoryHost, memoryTransport, startEngine } from '@juno/engine'
import { DEMO_TEAM_NAME, demoSeed, startFakeSlack, type Workspace } from '@juno/fake-slack'
import type { DemoSnapshot } from '@juno/state/demo'
import { makeDemoRecorder, type DemoRecorder } from '@juno/state/demo-capture'
import { portProtocol, type PortLike } from '@juno/state/transport'
import { fakeAddress, fakeMain, memorySessionStore, storedSession } from '../../host/fakeMain'

/** The longest one engine step may take: a first sync, or the AI jobs for every topic. */
const STEP_MS = 60_000
/** The folder under the output that holds the snapshot and its files. */
export const DEMO_DATA = 'demo'
/** The one tab the demo opens with. */
const DEMO_TAB = 'demo'
/** What a fake address that is not a file becomes. */
const DEMO_WORKSPACE = 'https://kestrel.slack.com'
const KINDS: ReadonlyArray<KindFilter> = ['all', 'channels', 'dms']

const engineLogger = Logger.make<unknown, void>((options) => {
  if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, 'Warn')) Logger.defaultLogger.log(options)
})

export interface DemoExport {
  readonly snapshot: DemoSnapshot
  /** Bytes of the snapshot as written. */
  readonly bytes: number
  readonly files: number
}

/**
 * Writes the snapshot and its files into `outDir/demo/`. `commit` is the
 * checkout's, so the page can tell a snapshot from another build.
 */
export async function exportDemo(outDir: string, commit: string): Promise<DemoExport> {
  const userData = mkdtempSync(join(tmpdir(), 'juno-demo-export-'))
  const stops: Array<() => unknown> = [() => rmSync(userData, { recursive: true, force: true })]
  try {
    const fake = await startFakeSlack({ seedTime: Date.now(), seed: demoSeed, teamName: DEMO_TEAM_NAME })
    stops.push(() => fake.close())
    const host = memoryHost()
    const main = fakeMain(host, { fakeUrl: fake.url, store: memorySessionStore(storedSession(fake.signIn())), signIn: () => Promise.resolve(fake.signIn()) })
    const transport = memoryTransport()
    const engine = await startEngine(transport, { userData, e2e: true, dev: true, fakeSlackUrl: fake.url, ai: 'fake', aiJobs: true }, { host, httpTransport: main.httpTransport, logger: engineLogger })
    stops.push(() => engine.stop())
    const recorder = await makeDemoRecorder(
      portProtocol({
        acquire: async () => {
          const channel = new MessageChannel()
          transport.add(channel.port2 as unknown as Parameters<typeof transport.add>[0])
          return channel.port1 as unknown as PortLike
        },
      }),
    )
    stops.push(() => recorder.close())

    await settle(recorder, fake.workspace)
    await recordShell(recorder)
    const reachable = await recordSidebar(recorder)
    await readTopics(recorder, fake.workspace, reachable)
    await recordPeople(recorder)

    const taken = recorder.snapshot(commit, Date.now())
    const dataDir = join(outDir, DEMO_DATA)
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(join(dataDir, 'files'), { recursive: true })
    const files = await localFiles(taken, dataDir, (url) => fakeAddress(url, fake.url), main.cookie)
    const text = JSON.stringify(files.snapshot)
    const local = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost)[^"\\]*/)
    if (local !== null) throw new Error(`demo export: the snapshot still names a local address, ${local[0]}`)
    writeFileSync(join(dataDir, 'snapshot.json'), text)
    return { snapshot: files.snapshot, bytes: Buffer.byteLength(text), files: files.count }
  } finally {
    for (const stop of stops.splice(0).toReversed()) await stop()
  }
}

const synced = (status: EngineStatus) => status.phase._tag === 'live' && !status.syncing

/**
 * Brings the workspace to what the demo shows: synced, every reachable
 * topic's history fetched, every sidebar thread titled and drawn by the AI
 * jobs, and the one tab open on the first thread.
 */
async function settle(recorder: DemoRecorder, workspace: Workspace): Promise<void> {
  await recorder.until(sessionStatus, undefined, (status) => status._tag === 'ready', STEP_MS)
  await recorder.until(engineStatus, undefined, synced, STEP_MS)
  const all = await recorder.list(topicsList, { kind: 'all', unreadOnly: false, range: { limit: SIDEBAR_WINDOW } })
  await readTopics(recorder, workspace, [...all.map((row) => row.id), ...(await switcherThreads(recorder, all.map((row) => row.channelId)))])
  // The title job takes the sidebar's threads only; a thread reached another way keeps its first message as its title.
  const threads = all.filter((row) => row.kind === 'thread').map((row) => row.id)
  await recorder.until(aiActivity, undefined, (activity) => {
    const done = (feature: string) => new Set(activity.calls.filter((call) => call.feature === feature && call.outcome === 'ok').map((call) => call.subject.id))
    const titled = done('titleTopic')
    const drawn = done('topicArt')
    return threads.every((id) => titled.has(id) && drawn.has(id))
  }, STEP_MS)
  await recorder.until(engineStatus, undefined, synced, STEP_MS)
  // The welcome card is about a real workspace; the demo has its own note.
  await recorder.reply(prefsSet, { key: 'tourSeen', value: true })
  await recorder.reply(prefsSet, { key: 'tabs', value: { tabs: [{ id: DEMO_TAB, pinned: false, place: { kind: 'topic', topicId: threads[0] ?? all[0]!.id } }], active: DEMO_TAB, recent: [DEMO_TAB] } })
}

/** What the shell reads as it starts, whatever is on screen. Reading only, it warms no composer, ⌘K or huddle. */
async function recordShell(recorder: DemoRecorder): Promise<void> {
  const session = await recorder.value(sessionStatus, undefined)
  if (session._tag !== 'ready') throw new Error(`demo export: the session is ${session._tag}, not ready`)
  await recorder.value(sessionProfile, undefined)
  await recorder.value(engineStatus, undefined)
  // The tabs are read per workspace, keyed by the id the session carries.
  await recorder.value(prefsGet, { key: 'tabs', workspace: session.workspaceId })
  await recorder.value(prefsGet, { key: 'tourSeen' })
  // The avatar menu follows the signed-in user's status.
  await recorder.value(statusOf, { userId: session.userId })
  // The chrome's and the rows' reads, idle here: no huddle or upload, notifications as they are, the workspace's emoji, nobody's presence shown.
  for (const route of [notificationsStatus, notificationsSettings, huddleRunning, uploadsProgress, mentionsEmoji, presencePeople]) await recorder.value(route, undefined)
}

/** Every list the sidebar can show: each quick filter, alone and in each view and each channel's scope. Returns the topics they offer. */
async function recordSidebar(recorder: DemoRecorder): Promise<ReadonlyArray<string>> {
  const rows = await recorder.list(topicsList, { kind: 'all', unreadOnly: false, range: { limit: SIDEBAR_WINDOW } })
  const channels = [...new Set(rows.map((row) => row.channelId))]
  const views = (await recorder.value(viewsList, undefined)).map((view) => view.id)
  const narrowings: ReadonlyArray<{ readonly scope?: string; readonly view?: string }> = [{}, ...views.map((view) => ({ view })), ...channels.map((scope) => ({ scope }))]
  for (const narrowing of narrowings) {
    if (narrowing.view === undefined) await recorder.value(topicsCounts, narrowing)
    for (const kind of KINDS) {
      for (const unreadOnly of [false, true]) await recorder.list(topicsList, { kind, unreadOnly, ...narrowing, range: { limit: SIDEBAR_WINDOW } })
    }
  }
  return [...rows.map((row) => row.id), ...(await switcherThreads(recorder, channels))]
}

/** Each channel's thread lists: the header's Threads button, and its topic switcher with every thread. Returns the switcher's. */
async function switcherThreads(recorder: DemoRecorder, channels: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
  const ids: Array<string> = []
  for (const channel of new Set(channels)) {
    await recorder.list(channelThreads, { channel, range: { limit: THREADS_WINDOW_MAX } })
    const every = await recorder.list(channelThreads, { channel, all: true, range: { limit: THREADS_WINDOW_MAX } })
    if (every.length >= THREADS_WINDOW_MAX) throw new Error(`demo export: ${channel} has more threads than the switcher holds`)
    ids.push(...every.map((thread) => thread.id))
  }
  return ids
}

/** Paging rounds one topic may take before the export gives up on it. */
const PAGING_ROUNDS = 50

/**
 * Each topic in `from`, and each one their messages link to, whole: opened,
 * paged until neither end has more, then its header and every message read.
 * Each must hold every message the fake has for it.
 */
async function readTopics(recorder: DemoRecorder, workspace: Workspace, from: ReadonlyArray<string>): Promise<void> {
  const queue = [...new Set(from)]
  const seen = new Set(queue)
  for (const id of queue) {
    const messages = await readTopic(recorder, id)
    const shown = new Set(messages.map((message) => message.id))
    const missing = fakeMessages(workspace, id).filter((ts) => !shown.has(ts))
    if (missing.length > 0) throw new Error(`demo export: ${id} lacks ${missing.length} of the fake's messages, such as ${missing[0]}`)
    for (const message of messages) {
      // A broadcast reply opens its thread at the reply, through `messages.loadAt`, which the snapshot does not answer.
      if (message.broadcastFrom !== undefined) throw new Error(`demo export: ${id} has a broadcast reply, which the demo cannot open`)
      const linked = message.thread?.id
      if (linked !== undefined && !seen.has(linked)) {
        seen.add(linked)
        queue.push(linked)
      }
    }
  }
}

async function readTopic(recorder: DemoRecorder, id: string): Promise<ReadonlyArray<MessageView>> {
  await recorder.reply(topicsOpen, { id })
  const read = async () => {
    const messages = await recorder.list(messagesList, { id, range: { limit: MESSAGE_WINDOW_MAX } })
    if (messages.length >= MESSAGE_WINDOW_MAX) throw new Error(`demo export: ${id} has more messages than one window holds`)
    return messages
  }
  let messages = await read()
  for (let round = 0; messages.length > 0; round++) {
    if (round === PAGING_ROUNDS) throw new Error(`demo export: ${id} was not whole after ${PAGING_ROUNDS} pages`)
    // The page keeps the last answer to each, so it stops paging at the ends.
    const older = await recorder.reply(messagesLoadOlder, { id, before: messages[0]!.id })
    const newer = await recorder.reply(messagesLoadNewer, { id, after: messages.at(-1)!.id })
    const again = await read()
    const same = again.length === messages.length && again.every((message, index) => message.id === messages[index]!.id)
    messages = again
    if (older.complete && newer.complete && same) break
  }
  await recorder.value(topicsGet, { id })
  return messages
}

/** The ts of every message the fake holds for a topic: Main's roots, plain messages and broadcasts, or a thread's root and replies. */
function fakeMessages(workspace: Workspace, id: string): ReadonlyArray<string> {
  const [kind, channel, threadTs] = id.split(':')
  if (kind === 'm' && channel !== undefined) return workspace.main(channel).map((message) => message.ts)
  if (kind === 't' && channel !== undefined && threadTs !== undefined) return [threadTs, ...workspace.replies(channel, threadTs).map((message) => message.ts)]
  throw new Error(`demo export: ${id} is not a topic id`)
}

/**
 * Where a click on each person the snapshot shows goes: everyone in a list's
 * refs (as `Message` opens them, an app's post by the user behind it) and
 * every @person in a message. One with no DM gets the engine's answer too,
 * which opens nothing. Each person's status too, for their avatar's tooltip.
 */
async function recordPeople(recorder: DemoRecorder): Promise<void> {
  const people = new Set<string>()
  JSON.stringify(recorder.snapshot('', 0).lists, (key, value: unknown) => {
    if (key === 'people' && Array.isArray(value)) for (const person of value as ReadonlyArray<Person>) people.add(person.user ?? person.id)
    const node = value as { readonly kind?: unknown; readonly id?: unknown } | null
    if (node !== null && typeof node === 'object' && node.kind === 'user' && typeof node.id === 'string') people.add(node.id)
    return value
  })
  for (const user of people) {
    await recorder.reply(peopleLocate, { user })
    await recorder.value(statusOf, { userId: user })
  }
}

const EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

/**
 * Copies every file the snapshot names on the fake into `dataDir/files/`
 * and points the snapshot at the copies, relative to the page. `juno://`
 * addresses carry the fake's address in `url`, as main's scheme reads it.
 * The workspace's emoji travel as a JSON string, so their table is decoded
 * for the walk and encoded again after it.
 */
async function localFiles(snapshot: DemoSnapshot, dataDir: string, onFake: (url: URL) => URL | undefined, cookie: () => string): Promise<{ readonly snapshot: DemoSnapshot; readonly count: number }> {
  const copies = new Map<string, string>()
  const source = (value: string): URL | undefined => {
    if (!URL.canParse(value)) return undefined
    const url = new URL(value)
    const inner = url.protocol === 'juno:' ? url.searchParams.get('url') : value
    return inner !== null && URL.canParse(inner) ? onFake(new URL(inner)) : undefined
  }
  const emojiKey = Object.keys(snapshot.values).find((key) => key.startsWith(`${mentionsEmoji._tag} `)) ?? ''
  const emoji = snapshot.values[emojiKey]
  const unpacked = typeof emoji === 'string' ? { ...snapshot, values: { ...snapshot.values, [emojiKey]: Schema.decodeSync(WorkspaceEmojiValue)(emoji) } } : snapshot
  const found = new Set<string>()
  JSON.stringify(unpacked, (_key, value: unknown) => {
    if (typeof value === 'string' && source(value) !== undefined) found.add(value)
    return value
  })
  for (const value of found) {
    const url = source(value)!
    const answer = await fetch(url, { headers: { cookie: cookie() }, redirect: 'manual' })
    const type = answer.headers.get('content-type')?.split(';')[0] ?? ''
    const extension = EXTENSIONS[type]
    if (!answer.ok || extension === undefined) {
      // Not a file, such as the workspace's address: name the invented workspace instead of a local port.
      copies.set(value, value.replace(url.origin, DEMO_WORKSPACE))
      continue
    }
    const bytes = new Uint8Array(await answer.arrayBuffer())
    const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${extension}`
    writeFileSync(join(dataDir, 'files', name), bytes)
    copies.set(value, `${DEMO_DATA}/files/${name}`)
  }
  const rewritten = JSON.parse(JSON.stringify(unpacked, (_key, value: unknown) => (typeof value === 'string' ? (copies.get(value) ?? value) : value))) as DemoSnapshot
  const packed: DemoSnapshot = typeof emoji === 'string' ? { ...rewritten, values: { ...rewritten.values, [emojiKey]: Schema.encodeSync(WorkspaceEmojiValue)(rewritten.values[emojiKey] as typeof WorkspaceEmojiValue.Type) } } : rewritten
  return { snapshot: packed, count: new Set([...copies.values()].filter((path) => path.startsWith(DEMO_DATA))).size }
}
