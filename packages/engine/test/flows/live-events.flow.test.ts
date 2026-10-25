// Live events (architecture 5.8): a reply, a read, a resolve, an edit, a delete, membership and workspace
// events each change only what they say, and an unknown user or an expired session is handled once.
// Every test starts warm on the synced default workspace.
import { afterEach, expect, it } from 'bun:test'
import { topicsResolve, type MessageView } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import { messagesAtom, openTopic, runCommand, sendMessage, type ListWindow } from '@juno/state'
import { waitFor, type RunningEngine } from '../harness'
import { bootedEngine, quiet, readDb, tsOf, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine, type SyncedOptions } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const synced = (options: SyncedOptions = {}) => syncedEngine(engines, options)

it('a reply, a read, a resolve, an edit and a delete each change their row and leave the others as they were', async () => {
  const engine = await synced()
  const before = await engine.rows()
  const plan = before.find((r) => r.title === 'Draft plan is in the doc')!
  const untouched = before.find((r) => r.id === 'm:C0DEPLOYS' || r.title === '#incidents') ?? before.find((r) => r.id !== plan.id && r.channel.id !== 'C0ENG')!

  await step('a reply from the socket updates one row; the others keep their objects', async () => {
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Dry run passed. <@U0TUSHAR> we are good for Thursday.', threadTs: tsOf(plan.id) })
    const after = await engine.rowsUntil((rows) => rows[0]?.id === plan.id && rows[0].messageCount === plan.messageCount + 1, 'the reply on top')
    expect(after[0]).toMatchObject({ preview: { sender: 'Leo', text: 'Dry run passed. @Tushar we are good for Thursday.' }, unreadCount: 1, unreadExact: true, mentionsMe: true })
    expect(after[0]!.rev).not.toBe(plan.rev)
    expect(after.find((r) => r.id === untouched.id)).toBe(untouched)
  })

  await step('a read mark from another client clears the unread count', async () => {
    const eng = (await engine.rows()).find((r) => r.title === '#eng')!
    expect(eng.unreadCount).toBeGreaterThan(0)
    engine.fake.markRead({ channel: 'C0ENG', ts: eng.lastActivityTs })
    const after = await engine.rowsUntil((rows) => rows.find((r) => r.id === eng.id)?.unreadCount === 0, 'eng read')
    expect(after.find((r) => r.id === eng.id)).toMatchObject({ unreadCount: 0, mentionsMe: false })
  })

  await step('a message after a resolve brings the topic back with the Reopened tag', async () => {
    const pricing = (await engine.rows()).find((r) => r.title === 'Final copy for pricing is in')!
    valueOf(await runCommand(engine.registry, topicsResolve, { id: pricing.id }))
    await engine.rowsUntil((rows) => !rows.some((r) => r.id === pricing.id), 'the resolved topic out of the list')
    engine.fake.injectMessage({ channel: 'C0PRODUCT', user: 'U0MAYA', text: 'Legal signed off.', threadTs: tsOf(pricing.id) })
    const after = await engine.rowsUntil((rows) => rows.find((r) => r.id === pricing.id)?.tags.includes('reopened') === true, 'the reopened tag')
    expect(after.find((r) => r.id === pricing.id)).toMatchObject({ tags: ['reopened'], resolved: false, preview: { sender: 'Maya', text: 'Legal signed off.' } })
  })

  await step('an edit and a delete reach the row; a one-to-one DM does not name its other side', async () => {
    const posted = engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'typo hear' })
    await engine.rowsUntil((rows) => rows[0]?.preview.text === 'typo hear', 'the new DM')
    engine.fake.editMessage({ channel: 'D0SAM', ts: posted.ts, text: 'typo here' })
    await engine.rowsUntil((rows) => rows[0]?.preview.text === 'typo here', 'the edit')
    engine.fake.deleteMessage({ channel: 'D0SAM', ts: posted.ts })
    const rows = await engine.rowsUntil((list) => list.find((r) => r.title === 'Sam')?.preview.text !== 'typo here', 'the delete')
    expect(rows.find((r) => r.title === 'Sam')?.preview.sender).toBe('')
  })

  await step('a joined channel shows up, a left one disappears', async () => {
    engine.fake.joinChannel({ channel: 'C0SALES' })
    engine.fake.injectMessage({ channel: 'C0SALES', user: 'U0ELENA', text: 'Welcome to sales.' })
    const joined = await engine.rowsUntil((list) => list.some((r) => r.channel.id === 'C0SALES'), 'the joined channel')
    expect(joined.find((r) => r.channel.id === 'C0SALES')).toMatchObject({ kind: 'main', title: '#sales', preview: { text: 'Welcome to sales.' } })
    engine.fake.leaveChannel({ channel: 'C0SALES' })
    await engine.rowsUntil((list) => !list.some((r) => r.channel.id === 'C0SALES'), 'the left channel gone')
  })

  await step('goes offline while the socket is down and comes back live on one socket', async () => {
    engine.fake.dropSocket()
    await engine.phase('offline')
    await engine.phase('live', 20_000)
    await engine.syncIdle()
    await waitFor(() => (engine.fake.socketCount() === 1 ? true : undefined), undefined, 'the reconnected socket')
  })
})

it('archive, unarchive, delete, leaving, closing a DM and a rename change only what they say', async () => {
  const engine = await synced()
  const eventTs = () => `${Math.floor(Date.now() / 1000)}.${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`
  const conversation = (id: string) =>
    readDb(engine, 'cache.db', (db) => db.prepare('SELECT kind, name, topic, is_member, is_archived FROM conversations WHERE id = ?').get(id)) as
      | { kind: string; name: string; topic: string | null; is_member: number; is_archived: number }
      | undefined
  const cases: ReadonlyArray<{ name: string; act: () => void; expect: () => boolean }> = [
    { name: 'archive', act: () => engine.fake.emitFrame({ type: 'channel_archive', channel: 'C0DEPLOYS', user: 'U0SAM', event_ts: eventTs() }), expect: () => conversation('C0DEPLOYS')?.is_archived === 1 },
    { name: 'unarchive', act: () => engine.fake.emitFrame({ type: 'channel_unarchive', channel: 'C0DEPLOYS', user: 'U0SAM', event_ts: eventTs() }), expect: () => conversation('C0DEPLOYS')?.is_archived === 0 },
    { name: 'delete', act: () => engine.fake.emitFrame({ type: 'channel_deleted', channel: 'C0SOCIAL', event_ts: eventTs() }), expect: () => conversation('C0SOCIAL')?.is_member === 0 },
    {
      name: 'self leaves',
      act: () => engine.fake.emitFrame({ type: 'member_left_channel', user: SELF_ID, channel: 'C0INCIDENTS', channel_type: 'C', team: engine.fake.teamId, event_ts: eventTs() }),
      expect: () => conversation('C0INCIDENTS')?.is_member === 0,
    },
    { name: 'im_close', act: () => engine.fake.emitFrame({ type: 'im_close', channel: 'D0SAM', user: SELF_ID, event_ts: eventTs() }), expect: () => conversation('D0SAM')?.is_member === 1 },
  ]
  for (const each of cases) {
    each.act()
    await waitFor(() => (each.expect() ? true : undefined), undefined, each.name)
  }
  const rows = await engine.rowsUntil((list) => !list.some((r) => r.channel.id === 'C0SOCIAL' || r.channel.id === 'C0INCIDENTS'), 'left channels gone')
  expect(rows.some((r) => r.channel.id === 'D0SAM')).toBe(true)

  // A rename sends a partial channel object: the private channel keeps its kind and topic.
  const hiring = conversation('C0HIRING')!
  engine.fake.renameChannel({ channel: 'C0HIRING', name: 'recruiting' })
  const renamed = await engine.rowsUntil((list) => list.some((r) => r.channel.label === '#recruiting'), 'the renamed channel')
  expect(conversation('C0HIRING')).toEqual({ ...hiring, name: 'recruiting' })
  expect(renamed.find((r) => r.channel.label === '#recruiting')?.channel.kind).toBe('private')
})

it('a user the edge does not know is asked for once per session, across reconnects', async () => {
  const engine = await synced()
  engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0GHOST', text: 'Hello from another org.' })
  await engine.rowsUntil((rows) => rows.some((r) => r.preview.text === 'Hello from another org.'), 'the message')
  const asked = () => engine.fake.calls.filter((c) => c.kind === 'edge' && JSON.stringify(c.args).includes('U0GHOST')).length
  for (let i = 0; i < 2; i++) {
    engine.fake.dropSocket()
    await engine.phase('offline')
    await engine.phase('live', 20_000)
    await quiet(engine)
  }
  expect(asked()).toBe(1)
})

it('an expired session found by the catch-up after a reconnect ends as session-expired (review M3 finding 4)', async () => {
  const engine = await synced()
  // The socket reconnects with its reconnect_url; the first API call of the catch-up meets the expired session.
  engine.fake.forceError({ method: 'client.counts', error: 'invalid_auth', times: 10 })
  engine.fake.dropSocket()
  await engine.status('authRequired')
  await engine.phase('session-expired')
})

it('a message from a deactivated person, and a rename of them while it is shown, keep the message readable and answerable', async () => {
  const engine = await bootedEngine(engines, {
    initial: (fake) => {
      const maya = fake.workspace.users.get('U0MAYA')!
      fake.workspace.users.set(maya.id, { ...maya, deleted: true })
      return fake.signIn()
    },
  })
  const atom = messagesAtom('m:C0ENG')
  const unmount = engine.registry.mount(atom)
  const windowUntil = (predicate: (window: ListWindow<MessageView>) => boolean, label: string) =>
    waitFor(() => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' && result.value.meta.seq > 0 && predicate(result.value) ? result.value : undefined
    }, undefined, label)
  try {
    valueOf(await openTopic(engine.registry, 'm:C0ENG'))
    const posted = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'A former teammate wrote this' })
    const shown = await windowUntil((window) => window.rows.has(posted.ts), 'the message')
    expect(shown.rows.get(posted.ts)!.senderId).toBe('U0MAYA')
    expect(shown.refs.people.get('U0MAYA')?.name).toBe('Maya')

    const maya = engine.fake.workspace.users.get('U0MAYA')!
    const renamed = { ...maya, deleted: true, real_name: 'Former teammate', profile: { ...maya.profile, display_name: 'Former teammate', real_name: 'Former teammate' } }
    engine.fake.workspace.users.set(maya.id, renamed)
    engine.fake.emitFrame({ type: 'user_change', user: renamed })
    await windowUntil((window) => window.refs.people.get('U0MAYA')?.name === 'Former teammate', 'the new name')

    valueOf(await sendMessage(engine.registry, { kind: 'channel', channelId: 'C0ENG' }, 'Reply to the old message', 'm:C0ENG'))
    await waitFor(() => (engine.fake.messages('C0ENG').some((message) => message.text === 'Reply to the old message') ? true : undefined), undefined, 'the reply in Slack')
  } finally {
    unmount()
  }
})
