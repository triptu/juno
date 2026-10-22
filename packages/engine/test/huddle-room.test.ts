// Call metadata through real routes and the fake Slack, including an edge that never lists it.
import { expect, it } from 'vitest'
import { huddleLeave } from '@juno/contract'
import { runCommand } from '@juno/state'
import { sleep, waitFor, WAIT_MS } from './harness'
import { valueOf } from './scenario'
import { booted, callUntil, inCall, report, runningUntil, SELF, stopHuddleEnginesAfterEach, stopMedia } from './huddleScenario'

stopHuddleEnginesAfterEach()

it('retains an unlisted DM call, follows a leave, ends on media termination, and starts a fresh room on rejoin', async () => {
  const engine = await booted({ timing: { huddleInfoSettleMillis: 300 } })
  engine.fake.control('setHuddleInfoLag', { ms: 60_000 })
  const first = await inCall(engine, 'D0MAYA')
  engine.fake.control('joinHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  const before = await callUntil(engine, (call) => call.participants.length === 2, 'both joined')
  await runningUntil(engine, (running) => running['D0MAYA'] === undefined, 'the lagging edge removed the listing')
  const kept = await callUntil(engine, () => true, 'retained room')
  expect(kept).toMatchObject({ phase: 'joined', participants: [SELF, 'U0MAYA'], startedAt: before.startedAt, joinedAt: before.joinedAt })
  engine.fake.control('leaveHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  await callUntil(engine, (call) => call.participants.join() === SELF, 'Maya left the retained room')
  engine.fake.control('endHuddle', { channel: 'D0MAYA' })
  await callUntil(engine, (call) => call.participants.length === 0 && call.phase === 'joined', 'room ended before media')
  await stopMedia(engine, first.attendeeId, 'ended')
  expect(await callUntil(engine, (call) => call.phase === 'idle', 'media ended')).toMatchObject({ joinedAt: null, ended: { reason: 'ended' } })
  const second = await inCall(engine, 'D0MAYA')
  expect(second.callId).not.toBe(first.callId)
  const rejoined = await callUntil(engine, (call) => call.participants.join() === SELF, 'new room')
  expect(rejoined.joinedAt).toBeGreaterThan(before.joinedAt ?? 0)
  valueOf(await runCommand(engine.registry, huddleLeave, undefined))
  await stopMedia(engine, second.attendeeId)
})

it('never leaves as alone while the media hears someone missing from the room roster', async () => {
  const engine = await booted({ timing: { huddleAloneMillis: 500 } })
  const joined = await inCall(engine, 'D0MAYA')
  await report(engine, { holds: joined.attendeeId, received: joined.attendeeId, hasRemote: true })
  await sleep(900)
  expect((await callUntil(engine, () => true, 'still connected')).phase).toBe('joined')
  await report(engine, { holds: joined.attendeeId, received: joined.attendeeId, hasRemote: false })
  await callUntil(engine, (call) => call.ended?.reason === 'alone', 'alone after media left')
  await stopMedia(engine, joined.attendeeId)
})

it('does not erase a channel first seen during a full read', async () => {
  const engine = await booted({ timing: { huddleInfoSettleMillis: 1_000 } })
  engine.fake.holdNext({ method: 'edge:huddles/info' })
  engine.fake.dropSocket()
  await waitFor(() => engine.fake.heldCount({ method: 'edge:huddles/info' }) === 1 || undefined, WAIT_MS, 'full read held')
  engine.fake.workspace.addConversation({ id: 'C0NEWROOM', name: 'new-room', kind: 'public', members: new Set([SELF, 'U0MAYA']), created: engine.fake.now(), topic: '', purpose: '', isOpen: true, archived: false })
  engine.fake.control('startHuddle', { channel: 'C0NEWROOM', user: 'U0MAYA' })
  await runningUntil(engine, (running) => running['C0NEWROOM'] !== undefined, 'new room frame')
  // Hold the repairing read as well: the in-flight full answer must not remove the frame.
  engine.fake.release()
  engine.fake.holdNext({ method: 'edge:huddles/info' })
  await sleep(300)
  expect((await runningUntil(engine, () => true, 'after full read'))['C0NEWROOM']).toBeDefined()
  engine.fake.release()
})
