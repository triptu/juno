import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import { editMessage, reactToMessage, resolveMessageAction, sendMessage } from '@juno/state'
import { apiCalls, readDb, valueOf } from './scenario'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { booted, eng, inSlack, MAIN, refOf, restarted, rowWith, sent, stopEnginesAfterEach, watch } from './actionScenario'

stopEnginesAfterEach()

const failures = (engine: RunningEngine) => readDb(engine, 'user.db', (db) =>
  db.prepare(`SELECT id, attempts, last_error, json_extract(payload_json, '$.failed') AS failed FROM outbox WHERE kind IN ('edit', 'delete', 'react') ORDER BY id`).all() as Array<{ id: number; attempts: number; last_error: string | null; failed: string | null }>)

// Change a persisted row only while the engine is stopped, as an existing install would leave it.
const persisted = (engine: RunningEngine, change: (db: DatabaseSync) => void) => {
  const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'user.db'))
  try { change(db) } finally { db.close() }
}

it('settles the partial chat.update response without an echo, including a thread reply and formatted text', async () => {
  const engine = await booted()
  const root = await sent(engine, 'Thread root', watch(engine, MAIN))
  const topic = `t:C0ENG:${root.ts}`
  const rows = watch(engine, topic)
  valueOf(await sendMessage(engine.registry, { ...eng, threadTs: root.ts }, 'Reply draft', topic))
  const reply = rowWith(await rows((list) => rowWith(list, 'Reply draft')?.pending === undefined && rowWith(list, 'Reply draft') !== undefined, 'stored reply'), 'Reply draft')!
  engine.fake.holdFrames({ types: ['message'] })
  valueOf(await editMessage(engine.registry, refOf(reply), 'Reply **changed**'))
  await waitFor(() => failures(engine).length === 0 ? true : undefined, WAIT_MS, 'partial response settled')
  await rows((list) => rowWith(list, 'Reply **changed**')?.edited === true, 'edited reply stays in its thread')
  expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
  expect<unknown>(inSlack(engine, reply.ts)?.thread_ts).toBe(root.ts)
})

it('ends a defect once, keeps the edit for dismissal, and releases the next reaction', async () => {
  const first = await booted()
  const message = await sent(first, 'Original text', watch(first, MAIN))
  first.fake.forceError({ method: 'chat.update', error: 'service_unavailable', times: 1000 })
  valueOf(await editMessage(first.registry, refOf(message), 'Saved edit'))
  await waitFor(() => failures(first)[0]?.attempts === 1 ? true : undefined, WAIT_MS, 'first try')
  const engine = await restarted(first, (fake) => {
    fake.clearError({ method: 'chat.update' })
    fake.resetCalls()
    persisted(first, (db) => db.exec(`UPDATE outbox SET payload_json = json_set(payload_json, '$.blocksJson', '{broken'), next_at = '0' WHERE kind = 'edit'`))
  })
  const failure = await waitFor(() => failures(engine).find((row) => row.failed === 'defect'), WAIT_MS, 'terminal defect')
  const rows = watch(engine, MAIN)
  await rows((list) => rowWith(list, 'Original text')?.actionIssue?.id === failure.id, 'edit failure shown')
  valueOf(await reactToMessage(engine.registry, refOf(message), 'eyes', true))
  await waitFor(() => inSlack(engine, message.ts)?.reactions?.some((reaction) => reaction.name === 'eyes') ? true : undefined, WAIT_MS, 'later reaction sent')
  expect(apiCalls(engine, 'chat.update')).toHaveLength(0)
  valueOf(await resolveMessageAction(engine.registry, failure.id, false))
  await rows((list) => rowWith(list, 'Original text')?.actionIssue === undefined, 'dismissed')
})

it('retires legacy defects and exhausted attempts on launch without sending them', async () => {
  const first = await booted()
  const rows = watch(first, MAIN)
  const one = await sent(first, 'Old one', rows)
  const two = await sent(first, 'Old two', rows)
  const three = await sent(first, 'Old three', rows)
  first.fake.forceError({ method: 'chat.update', error: 'service_unavailable', times: 1000 })
  for (const message of [one, two, three]) valueOf(await editMessage(first.registry, refOf(message), 'Old edit'))
  await waitFor(() => failures(first)[0]?.attempts === 1 ? true : undefined, WAIT_MS, 'backoff')
  valueOf(await reactToMessage(first.registry, refOf(three), 'eyes', true))
  const engine = await restarted(first, (fake) => {
    fake.clearError({ method: 'chat.update' })
    fake.resetCalls()
    persisted(first, (db) => {
      db.exec(`UPDATE outbox SET attempts = 3816, last_error = 'service_unavailable', next_at = '9999999999999' WHERE kind = 'edit'`)
      db.exec(`UPDATE outbox SET attempts = 1, last_error = 'defect' WHERE id = (SELECT min(id) FROM outbox WHERE kind = 'edit')`)
    })
  })
  await waitFor(() => failures(engine).filter((row) => row.failed !== null).length === 3 ? true : undefined, WAIT_MS, 'all legacy rows stopped')
  await waitFor(() => inSlack(engine, three.ts)?.reactions?.some((reaction) => reaction.name === 'eyes') ? true : undefined, WAIT_MS, 'later row sent')
  expect(apiCalls(engine, 'chat.update')).toHaveLength(0)
  const failed = failures(engine)[0]!
  valueOf(await resolveMessageAction(engine.registry, failed.id, true))
  await waitFor(() => inSlack(engine, one.ts)?.text === 'Old edit' ? true : undefined, WAIT_MS, 'explicit retry sent')
  expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
})

it('stops transient failures after five exchanges and allows an explicit retry', async () => {
  const engine = await booted()
  const rows = watch(engine, MAIN)
  const message = await sent(engine, 'Transient original', rows)
  engine.fake.forceError({ method: 'chat.update', error: 'service_unavailable', times: 1000 })
  valueOf(await editMessage(engine.registry, refOf(message), 'Transient edit'))
  const failure = await waitFor(() => failures(engine).find((row) => row.failed !== null), WAIT_MS, 'retry budget spent')
  expect(apiCalls(engine, 'chat.update')).toHaveLength(5)
  await rows((list) => rowWith(list, 'Transient original')?.actionIssue !== undefined, 'failure visible')
  engine.fake.clearError({ method: 'chat.update' })
  valueOf(await resolveMessageAction(engine.registry, failure.id, true))
  await waitFor(() => failures(engine).length === 0 ? true : undefined, WAIT_MS, 'retry settled')
  await rows((list) => rowWith(list, 'Transient edit')?.actionIssue === undefined, 'successful edit visible')
})

it.each(['deleted', 'left'] as const)('settles an edit refused because the message was %s elsewhere without a defect', async (reason) => {
  const engine = await booted()
  const message = await sent(engine, 'Before remote change', watch(engine, MAIN))
  engine.fake.holdFrames({ types: ['message', 'channel_left', 'member_left_channel'] })
  if (reason === 'deleted') engine.fake.deleteMessage({ channel: 'C0ENG', ts: message.ts })
  else engine.fake.leaveChannel({ channel: 'C0ENG' })
  valueOf(await editMessage(engine.registry, refOf(message), 'After remote change'))
  await waitFor(() => failures(engine).length === 0 ? true : undefined, WAIT_MS, 'refusal settled')
  expect(apiCalls(engine, 'chat.update')).toHaveLength(1)
})
