/**
 * Running huddles from the socket: room frames apply at once, and the
 * edge `huddles/info` is read for every channel due. A connect, a
 * reconnect or `Overflowed` makes every channel due; a room frame makes its
 * own channel due. A read is dropped when a socket gap, or a frame for that
 * channel, came while it was out (specs/huddle.qnt, `answerInfo` and
 * `discardInfo`). Frames never change the call.
 */
import { Effect, Queue, Result } from 'effect'
import type { HuddleInfo } from '@juno/slack-schema'
import { markDue, publish, type Attached, type Core } from './core'
import type { HuddleListener } from './Huddle'
import { applyInfo, applyRoomFrame, decodeRoomFrame } from './running'
import { infoRequest } from './slack'

/** How long reads wait after the first change, so a burst of frames costs one read. */
export const INFO_DEBOUNCE_MILLIS = 150

/** Applies one read's answer under the lock, or puts its channels back when it was overtaken. */
const applyRead = (core: Core, to: Attached, read: { readonly all: boolean; readonly ids: ReadonlySet<string>; readonly gap: number; readonly gens: ReadonlyMap<string, number> }, huddles: ReadonlyArray<HuddleInfo>) =>
  core.lock.withPermits(1)(Effect.gen(function* () {
    const info = to.info
    if (core.attached !== to) return
    // A gap while the read was out: the whole answer may predate what was lost (model `discardInfo`).
    if (read.gap !== info.gap || !info.connected) {
      if (read.all) info.dirtyAll = true
      for (const id of read.ids) info.dirty.add(id)
      return yield* Queue.offer(info.wake, undefined)
    }
    // A channel with a frame since the read asked is read again.
    const fresh = [...read.ids].filter((id) => (info.frameGen.get(id) ?? 0) === read.gens.get(id))
    for (const id of read.ids) if (!fresh.includes(id)) info.dirty.add(id)
    let next = applyInfo(core.running, fresh, huddles)
    // A full read also drops channels the user is no longer in.
    if (read.all) next = applyInfo(next, [...next.keys()].filter((channel) => !read.ids.has(channel)), [])
    core.running = next
    if (info.dirty.size > 0) yield* Queue.offer(info.wake, undefined)
    yield* publish(core)
  }))

/** Reads due channels while the socket is up, one read at a time, for as long as the session lasts. */
export const reader = (core: Core, to: Attached) =>
  Effect.gen(function* () {
    const info = to.info
    let backoff = 1_000
    const retryLater = Effect.suspend(() => {
      const wait = backoff
      backoff = Math.min(backoff * 2, 60_000)
      return Effect.forkIn(Effect.sleep(wait).pipe(Effect.andThen(Queue.offer(info.wake, undefined))), to.work)
    })
    while (true) {
      yield* Queue.take(info.wake)
      yield* Effect.sleep(INFO_DEBOUNCE_MILLIS)
      if (!info.connected || (!info.dirtyAll && info.dirty.size === 0)) continue
      const all = info.dirtyAll
      const ids = new Set(info.dirty)
      if (all) for (const channel of yield* to.session.channels) ids.add(channel)
      // The first sync has not stored the conversations yet.
      if (all && ids.size === 0) yield* retryLater
      if (ids.size === 0) continue
      info.dirtyAll = false
      info.dirty.clear()
      const read = { all, ids, gap: info.gap, gens: new Map([...ids].map((id) => [id, info.frameGen.get(id) ?? 0])) }
      const answer = yield* Effect.result(infoRequest(to.session, ids))
      if (Result.isSuccess(answer)) {
        backoff = 1_000
        yield* applyRead(core, to, read, answer.success)
        continue
      }
      yield* Effect.logWarning('huddle: huddles/info failed', { error: answer.failure._tag })
      if (all) info.dirtyAll = true
      for (const id of ids) info.dirty.add(id)
      yield* retryLater
    }
  })

/** The session's socket listener. Model `roomFrame`, `disconnect`, `reconnect` and `overflow`. */
export const listener = (core: Core, to: Attached): HuddleListener => (input) =>
  core.lock.withPermits(1)(Effect.gen(function* () {
    if (core.attached !== to) return
    const info = to.info
    switch (input._tag) {
      case 'Frame': {
        if (input.frame.type !== 'unknown') return
        const frame = decodeRoomFrame(input.frame.raw)
        if (frame === undefined) return
        // The running list may change and the channel is due for a read; the call never changes.
        info.frameGen.set(frame.channelId, (info.frameGen.get(frame.channelId) ?? 0) + 1)
        core.running = applyRoomFrame(core.running, frame)
        yield* markDue(to, frame.channelId)
        return yield* publish(core)
      }
      case 'Connected':
        info.connected = true
        info.gap += 1
        return yield* markDue(to, 'all')
      case 'Disconnected':
        info.connected = false
        info.gap += 1
        return
      case 'Overflowed':
        info.gap += 1
        return yield* markDue(to, 'all')
    }
  }))
