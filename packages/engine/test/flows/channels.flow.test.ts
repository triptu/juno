// Making and editing channels (SPEC 5, "Channel sheet"; research slack-channels.md): a create invites whom
// Slack can add and names the rest, a rename shows at once and goes back when Slack refuses it while the
// member changes still land, and the undo puts back what Slack did. The sheet itself is the DOM lane's.
// Starts warm on the synced default workspace.
import { afterEach, expect, it } from 'bun:test'
import { channelsCreate, channelsEdit } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import { runCommand } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { readDb, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const MAYA = 'U0MAYA'

const stored = (engine: RunningEngine, channel: string) =>
  readDb(engine, 'cache.db', (db) => db.prepare('SELECT name, kind, is_member FROM conversations WHERE id = ?').get(channel) as { name: string; kind: string; is_member: number } | undefined)

const members = (engine: RunningEngine, channel: string) => [...(engine.fake.workspace.conversation(channel)?.members ?? [])].toSorted()

it('a create names whom Slack could not add; a refused rename goes back while the removal lands; the undo puts back what Slack did', async () => {
  const engine = await syncedEngine(engines)
  let channel = ''

  await step('a private channel is made under the name Slack takes, with the people Slack could add', async () => {
    const created = valueOf(await runCommand(engine.registry, channelsCreate, { name: 'Ops Room', isPrivate: true, members: [MAYA, 'U0NOBODY'] }))
    channel = created.channelId
    expect(created).toMatchObject({ name: 'ops-room', topicId: `m:${channel}` })
    expect(created.notAdded.map((issue) => [issue.person.id, issue.code])).toEqual([['U0NOBODY', 'user_not_found']])
    expect(members(engine, channel)).toEqual([MAYA, SELF_ID].toSorted())
    // Stored before the socket says so, so its Main opens at once.
    expect(stored(engine, channel)).toEqual({ name: 'ops-room', kind: 'private', is_member: 1 })
    // The create's own `channel_joined` carries the name too; the next step reads the name after it has landed.
    await engine.socketIdle()
  })

  await step('a rename Slack refuses shows at once, then the old name is back; the removal still lands', async () => {
    // #eng has the name already: Slack answers name_taken. The answer waits, so the shown name can be read first.
    engine.fake.holdNext({ method: 'conversations.rename' })
    const pending = runCommand(engine.registry, channelsEdit, { channel, name: 'eng', add: [], remove: [MAYA] })
    await waitFor(() => (stored(engine, channel)?.name === 'eng' ? true : undefined), WAIT_MS, 'the new name shown before Slack answers')
    engine.fake.release()
    const edited = valueOf(await pending)
    expect(edited).toMatchObject({ name: 'ops-room', renameRefused: 'name_taken', notAdded: [], notRemoved: [] })
    expect(stored(engine, channel)?.name).toBe('ops-room')
    expect(members(engine, channel)).toEqual([SELF_ID])
    // Only the removal happened, so only it is undone.
    expect(edited.undo).toEqual({ _tag: 'channels.edit', channel, add: [MAYA], remove: [] })
  })

  await step('a rename Slack takes, then its undo, puts back the old name and the member', async () => {
    const edited = valueOf(await runCommand(engine.registry, channelsEdit, { channel, name: 'Ops Room 2', add: [MAYA], remove: [] }))
    expect(edited).toMatchObject({ name: 'ops-room-2', notAdded: [], notRemoved: [] })
    expect(engine.fake.workspace.conversation(channel)?.name).toBe('ops-room-2')
    expect(edited.undo).toEqual({ _tag: 'channels.edit', channel, name: 'ops-room', add: [], remove: [MAYA] })
    if (edited.undo?._tag !== 'channels.edit') throw new Error('no undo')
    const { _tag: _, ...undo } = edited.undo
    valueOf(await runCommand(engine.registry, channelsEdit, undo))
    expect(engine.fake.workspace.conversation(channel)?.name).toBe('ops-room')
    expect(members(engine, channel)).toEqual([SELF_ID])
    await waitFor(() => (stored(engine, channel)?.name === 'ops-room' ? true : undefined), WAIT_MS, 'the old name stored')
  })
})
