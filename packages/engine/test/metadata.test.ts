import { sendMessage } from '@juno/state'
import { afterEach, describe, expect, it } from 'vitest'
import { startTestEngine, waitFor, type RunningEngine } from './harness'
import { bootedEngine, readDb, valueOf } from './scenario'

const engines: RunningEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function conversation(engine: RunningEngine, id = 'C0ENG') {
  return readDb(engine, 'cache.db', (db) => db.prepare('SELECT name, is_member, is_archived, topic, purpose FROM conversations WHERE id = ?').get(id))
}

async function holdRefresh(engine: RunningEngine, method: string) {
  engine.fake.holdNext({ method })
  engine.fake.dropSocket()
  await waitFor(() => engine.fake.heldCount({ method }) === 1 ? true : undefined, 30_000, 'metadata snapshot held')
}

async function finish(engine: RunningEngine) {
  engine.fake.release()
  await engine.syncIdle()
}

describe('conversation observation fence', () => {
  it('repairs a missed rename, leave and archive after a gap with one workspace and one full counts call', async () => {
    const engine = await bootedEngine(engines)
    const { fake } = engine
    fake.goOffline()
    await engine.phase('offline')
    fake.renameChannel({ channel: 'C0ENG', name: 'engineering' })
    fake.leaveChannel({ channel: 'C0PRODUCT' })
    fake.workspace.conversations.get('C0PLATFORM')!.archived = true
    fake.resetCalls()
    fake.goOnline()
    await engine.phase('live', 30_000)
    await engine.syncIdle()
    expect(conversation(engine)).toMatchObject({ name: 'engineering' })
    expect(conversation(engine, 'C0PRODUCT')).toMatchObject({ is_member: 0 })
    expect(conversation(engine, 'C0PLATFORM')).toMatchObject({ is_archived: 1 })
    expect(fake.calls.filter((c) => c.method === 'client.userBoot')).toHaveLength(1)
    const counts = fake.calls.filter((c) => c.method === 'client.counts')
    expect(counts).toHaveLength(1)
    expect(counts[0]!.args['counts_last_fetched']).toBeUndefined()
  })

  it('keeps a rename observed before the first workspace snapshot creates its row', async () => {
    const engine = await startTestEngine({ initial: (fake) => {
      fake.holdNext({ method: 'client.userBoot' })
      return fake.signIn()
    } })
    engines.push(engine)
    await engine.status('ready')
    await waitFor(() => engine.fake.heldCount({ method: 'client.userBoot' }) === 1 ? true : undefined, 30_000, 'first workspace snapshot held')
    await waitFor(() => engine.fake.socketCount() === 1 ? true : undefined, 20_000, 'socket connected')
    engine.fake.renameChannel({ channel: 'C0ENG', name: 'engineering' })
    // Socket frames are consumed in order. This message witnesses that the preceding rename was applied.
    const barrier = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'After the rename.' })
    await waitFor(() => readDb(engine, 'cache.db', (db) => db.prepare('SELECT ts FROM messages WHERE channel = ? AND ts = ?').get('C0ENG', barrier.ts)), 20_000, 'socket barrier stored')
    await finish(engine)
    expect(conversation(engine)).toMatchObject({ name: 'engineering', is_member: 1 })
  })

  it('keeps a newer rename but refreshes untouched fields from the held workspace snapshot', async () => {
    const engine = await bootedEngine(engines)
    engine.fake.workspace.conversations.get('C0ENG')!.topic = 'Topic changed during the gap'
    await holdRefresh(engine, 'client.userBoot')
    engine.fake.renameChannel({ channel: 'C0ENG', name: 'engineering' })
    await engine.rowsUntil((rows) => rows.some((r) => r.title === '#engineering'), 'rename event applied')
    await finish(engine)
    expect(conversation(engine)).toMatchObject({ name: 'engineering', topic: 'Topic changed during the gap' })
  })

  it('keeps an archive event over a held workspace snapshot', async () => {
    const engine = await bootedEngine(engines)
    await holdRefresh(engine, 'client.userBoot')
    engine.fake.workspace.conversations.get('C0ENG')!.archived = true
    engine.fake.emitFrame({ type: 'channel_archive', channel: 'C0ENG' })
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === 'm:C0ENG'), 'archive event applied')
    await finish(engine)
    expect(conversation(engine)).toMatchObject({ is_archived: 1 })
  })

  it('keeps both a leave and a join over the full membership snapshot', async () => {
    const engine = await bootedEngine(engines)
    engine.fake.leaveChannel({ channel: 'C0PRODUCT' })
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === 'm:C0PRODUCT'), 'left product')
    await holdRefresh(engine, 'client.counts')
    engine.fake.leaveChannel({ channel: 'C0ENG' })
    engine.fake.joinChannel({ channel: 'C0PRODUCT' })
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === 'm:C0ENG') && rows.some((r) => r.id === 'm:C0PRODUCT'), 'membership events applied')
    await finish(engine)
    expect(conversation(engine)).toMatchObject({ is_member: 0 })
    expect(conversation(engine, 'C0PRODUCT')).toMatchObject({ is_member: 1 })
  })
})

it('keeps an own DM open when an older counts snapshot lands without its socket echo', async () => {
  const engine = await bootedEngine(engines)
  await holdRefresh(engine, 'client.counts')
  engine.fake.holdFrames({ types: ['im_created', 'im_open'] })
  const { topicId } = valueOf(await sendMessage(engine.registry, { kind: 'person', userId: 'U0JONAS' }, 'Hello'))
  expect(conversation(engine, topicId.slice(2))).toMatchObject({ is_member: 1 })
  await finish(engine)
  expect(conversation(engine, topicId.slice(2))).toMatchObject({ is_member: 1 })
  engine.fake.releaseFrames({ drop: true })
})

it('leaves omitted topic and purpose to the snapshot while a partial event changes the name', async () => {
  const engine = await bootedEngine(engines)
  const channel = engine.fake.workspace.conversations.get('C0ENG')!
  channel.topic = 'New topic'
  channel.purpose = 'New purpose'
  await holdRefresh(engine, 'client.userBoot')
  engine.fake.emitFrame({ type: 'channel_created', channel: { id: 'C0ENG', name: 'renamed' } })
  await engine.rowsUntil((rows) => rows.some((r) => r.title === '#renamed'), 'partial event applied')
  await finish(engine)
  expect(conversation(engine)).toMatchObject({ name: 'renamed', topic: 'New topic', purpose: 'New purpose' })
  engine.fake.emitFrame({ type: 'channel_created', channel: { id: 'C0ENG', topic: { value: '' }, purpose: { value: '' } } })
  await waitFor(() => {
    const row = conversation(engine) as { topic: string; purpose: string }
    return row.topic === '' && row.purpose === '' ? true : undefined
  })
})

it('merges a partial incremental counts row without clearing unread state or latest', async () => {
  const engine = await bootedEngine(engines, { sweepIntervalMillis: 500 })
  const reads = () => readDb(engine, 'cache.db', (db) => db.prepare(
    "SELECT slack_last_read, latest, has_unreads, mention_count, counts_updated FROM channel_reads WHERE channel = 'C0ENG'",
  ).get())
  const before = reads()
  // Beyond the last change: the fake now sends { id, last_read } for this channel.
  engine.fake.advanceClock({ millis: 5_000 })
  engine.fake.workspace.changedAt.clear()
  const pointer = engine.fake.workspace.main('C0ENG').at(-1)!.ts
  engine.fake.workspace.reads.set('C0ENG', pointer)
  await waitFor(() => {
    const row = reads()
    return row?.counts_updated !== before?.counts_updated ? row : undefined
  }, 20_000, 'partial counts merged')
  expect(reads()).toMatchObject({
    slack_last_read: pointer, latest: before?.latest,
    has_unreads: before?.has_unreads, mention_count: before?.mention_count,
  })
  expect(engine.fake.calls.some((call) => call.method === 'client.counts' && call.args['counts_last_fetched'] !== undefined)).toBe(true)
})
