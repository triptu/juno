/**
 * The demo exporter (`docs/development.md`, "Demo"): runs the real engine
 * against the fake Slack seeded with the demo company (`demoSeed`), with
 * the fake AI and its background jobs so topics get titles and art, and
 * reads through the engine's own routes everything the read-only demo can
 * show. It writes `demo/snapshot.json`, which `@juno/state/demo` answers
 * the page from, and the files the snapshot names (avatars, images) beside
 * it, with every address rewritten to a relative one.
 *
 * Every topic in the sidebar is opened and read whole, so the demo never
 * needs a page it does not have. Nothing here waits a fixed time: each
 * step waits for the engine to say it is done.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { Logger, LogLevel } from 'effect'
import {
  aiActivity,
  channelThreads,
  draftsGet,
  huddleCall,
  huddleIncoming,
  huddleRunning,
  mentionsEmoji,
  mentionsPeople,
  newChatRanked,
  notificationsSettings,
  presencePeople,
  notificationsStatus,
  searchQuery,
  uploadsProgress,
  engineStatus,
  emojiFrequent,
  emojiRecent,
  messagesList,
  messagesLoadNewer,
  messagesLoadOlder,
  MESSAGE_WINDOW_MAX,
  prefsGet,
  prefsSet,
  sessionProfile,
  sessionStatus,
  SIDEBAR_WINDOW,
  THREADS_WINDOW_MAX,
  topicsCounts,
  topicsGet,
  topicsList,
  topicsOpen,
  viewsList,
  type EngineStatus,
  type KindFilter,
  type TopicListRow,
} from '@juno/contract'
import { memoryHost, memoryTransport, startEngine } from '@juno/engine'
import { DEMO_TEAM_NAME, demoSeed, startFakeSlack } from '@juno/fake-slack'
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

    await settle(recorder)
    await recordShell(recorder)
    const rows = await recordSidebar(recorder)
    await recordTopics(recorder, rows)

    const taken = recorder.snapshot(commit, Date.now())
    const dataDir = join(outDir, DEMO_DATA)
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(join(dataDir, 'files'), { recursive: true })
    const files = await localFiles(taken, dataDir, (url) => fakeAddress(url, fake.url), main.cookie)
    const text = JSON.stringify(files.snapshot)
    writeFileSync(join(dataDir, 'snapshot.json'), text)
    return { snapshot: files.snapshot, bytes: Buffer.byteLength(text), files: files.count }
  } finally {
    for (const stop of stops.splice(0).toReversed()) await stop()
  }
}

const synced = (status: EngineStatus) => status.phase._tag === 'live' && !status.syncing

/**
 * Brings the workspace to what the demo shows: synced, every topic's
 * history fetched, every thread titled and drawn by the AI jobs, and the
 * one tab open on the first thread.
 */
async function settle(recorder: DemoRecorder): Promise<void> {
  await recorder.until(sessionStatus, undefined, (status) => status._tag === 'ready', STEP_MS)
  await recorder.until(engineStatus, undefined, synced, STEP_MS)
  const all = await recorder.list(topicsList, { kind: 'all', unreadOnly: false, range: { limit: SIDEBAR_WINDOW } })
  for (const row of all) await recorder.reply(topicsOpen, { id: row.id })
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

/** What the shell reads as it starts, whatever is on screen. */
async function recordShell(recorder: DemoRecorder): Promise<void> {
  await recorder.value(sessionStatus, undefined)
  await recorder.value(sessionProfile, undefined)
  await recorder.value(engineStatus, undefined)
  await recorder.value(emojiRecent, {})
  await recorder.value(emojiFrequent, {})
  for (const key of ['tabs', 'tourSeen']) await recorder.value(prefsGet, { key })
  // The chrome's reads, all idle here: no call, no upload, notifications as they are.
  for (const route of [notificationsStatus, notificationsSettings, huddleCall, huddleIncoming, huddleRunning, uploadsProgress, mentionsEmoji, presencePeople]) await recorder.value(route, undefined)
  // ⌘K's empty state, which the shell warms when idle.
  await recorder.value(newChatRanked, { query: '' })
  await recorder.value(searchQuery, { query: '', limit: 6, places: false })
}

/** Every list the sidebar can show: each quick filter, alone and in each view and each channel's scope. Returns All. */
async function recordSidebar(recorder: DemoRecorder): Promise<ReadonlyArray<TopicListRow>> {
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
  for (const channel of channels) {
    for (const every of [false, true]) await recorder.list(channelThreads, { channel, ...(every ? { all: true } : {}), range: { limit: THREADS_WINDOW_MAX } })
  }
  return rows
}

/** Each topic whole: its header, every message, and the answers to paging past either end. */
async function recordTopics(recorder: DemoRecorder, rows: ReadonlyArray<TopicListRow>): Promise<void> {
  for (const row of rows) {
    await recorder.value(topicsGet, { id: row.id })
    await recorder.value(draftsGet, { topicId: row.id })
    // The composer's mention suggestions, warmed with an empty query when a topic opens.
    const thread = /^t:[^:]+:(.+)$/.exec(row.id)?.[1]
    await recorder.value(mentionsPeople, { channel: row.channelId, ...(thread === undefined ? {} : { threadTs: thread }), query: '' })
    const messages = await recorder.list(messagesList, { id: row.id, range: { limit: MESSAGE_WINDOW_MAX } })
    if (messages.length >= MESSAGE_WINDOW_MAX) throw new Error(`demo export: ${row.id} has more messages than one window holds`)
    const first = messages[0]
    const last = messages.at(-1)
    if (first !== undefined) await recorder.reply(messagesLoadOlder, { id: row.id, before: first.id })
    if (last !== undefined) await recorder.reply(messagesLoadNewer, { id: row.id, after: last.id })
  }
}

const EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

/**
 * Copies every file the snapshot names on the fake into `dataDir/files/`
 * and points the snapshot at the copies, relative to the page. `juno://`
 * addresses carry the fake's address in `url`, as main's scheme reads it.
 */
async function localFiles(snapshot: DemoSnapshot, dataDir: string, onFake: (url: URL) => URL | undefined, cookie: () => string): Promise<{ readonly snapshot: DemoSnapshot; readonly count: number }> {
  const copies = new Map<string, string>()
  const source = (value: string): URL | undefined => {
    if (!URL.canParse(value)) return undefined
    const url = new URL(value)
    const inner = url.protocol === 'juno:' ? url.searchParams.get('url') : value
    return inner !== null && URL.canParse(inner) ? onFake(new URL(inner)) : undefined
  }
  const found = new Set<string>()
  JSON.stringify(snapshot, (_key, value: unknown) => {
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
  const rewritten = JSON.parse(JSON.stringify(snapshot, (_key, value: unknown) => (typeof value === 'string' ? (copies.get(value) ?? value) : value))) as DemoSnapshot
  return { snapshot: rewritten, count: new Set([...copies.values()].filter((path) => path.startsWith(DEMO_DATA))).size }
}
