/**
 * Running huddles from the socket: room frames apply at once, and the
 * edge `huddles/info` is read for every channel due. A connect, a
 * reconnect or `Overflowed` makes every channel due; a room frame or the
 * user's own join makes its channel due. Slack's edge answers from a
 * moment ago, so a due channel is read only once it has been quiet for
 * `INFO_SETTLE_MILLIS` (specs/huddle.qnt, `settle`). A read is dropped
 * when a socket gap, or a frame for that channel, came while it was out
 * (`answerInfo` and `discardInfo`). Frames never change the call.
 *
 * `Overflowed` means events were dropped, a connect or a drop among them,
 * so the connection is `unknown` after it and reads go on; only a
 * `Disconnected` the service saw stops them.
 */
import { Clock, Effect, Queue, Result } from 'effect'
import type { HuddleInfo } from '@juno/slack-schema'
import { markDue, publish, type Attached, type Core } from './core'
import type { HuddleListener } from './Huddle'
import { applyInfo, applyRoomFrame, decodeRoomFrame } from './running'
import { infoRequest } from './slack'

/** How long reads wait after the first change, so a burst of frames costs one read. */
export const INFO_DEBOUNCE_MILLIS = 150

/** Applies one read's answer under the lock, or puts its channels back when it was overtaken. */
const applyRead = (core: Core, to: Attached, read: Read, huddles: ReadonlyArray<HuddleInfo>) =>
  core.lock.withPermits(1)(Effect.gen(function* () {
    const info = to.info
    if (core.attached !== to) return
    // A gap while the read was out: the whole answer may predate what was lost (model `discardInfo`).
    if (read.gap !== info.gap || info.connection === 'down') {
      if (read.all) info.dirtyAll = true
      for (const id of read.ids) info.dirty.add(id)
      return yield* Queue.offer(info.wake, undefined)
    }
    // A channel with a frame since the read asked, or not yet quiet when it asked, is read again.
    const fresh = [...read.ids].filter((id) => (info.frameGen.get(id) ?? 0) === read.gens.get(id) && (info.quietAt.get(id) ?? 0) <= read.at)
    for (const id of read.ids) if (!fresh.includes(id)) info.dirty.add(id)
    let next = applyInfo(core.running, fresh, huddles)
    // A full read also drops channels the user is no longer in.
    if (read.all) next = applyInfo(next, [...next.keys()].filter((channel) => !read.ids.has(channel)), [])
    core.running = next
    if (info.dirty.size > 0) yield* Queue.offer(info.wake, undefined)
    yield* publish(core)
  }))

interface Read {
  readonly all: boolean
  readonly ids: ReadonlySet<string>
  readonly gap: number
  readonly gens: ReadonlyMap<string, number>
  /** When it was sent. */
  readonly at: number
}

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
    // The time of the wake already set for the next channel to go quiet, if any.
    let wakeAt = Infinity
    const wakeWhenQuiet = (at: number, now: number) => Effect.suspend(() => {
      if (at >= wakeAt) return Effect.void
      wakeAt = at
      return Effect.forkIn(Effect.sleep(at - now).pipe(Effect.andThen(Effect.sync(() => {
        if (wakeAt === at) wakeAt = Infinity
      })), Effect.andThen(Queue.offer(info.wake, undefined))), to.work)
    })
    while (true) {
      yield* Queue.take(info.wake)
      yield* Effect.sleep(INFO_DEBOUNCE_MILLIS)
      if (info.connection === 'down' || (!info.dirtyAll && info.dirty.size === 0)) continue
      const now = yield* Clock.currentTimeMillis
      const quiet = (id: string) => (info.quietAt.get(id) ?? 0) <= now
      const all = info.dirtyAll && info.allQuietAt <= now
      // The rest wait until they are quiet. A full read asks for them too, but they stay due and their answer is not taken.
      const waiting = [...(info.dirtyAll && !all ? [info.allQuietAt] : []), ...[...info.dirty].filter((id) => !quiet(id)).map((id) => info.quietAt.get(id) ?? 0)]
      if (waiting.length > 0) yield* wakeWhenQuiet(Math.min(...waiting), now)
      const ids = new Set(all ? info.dirty : [...info.dirty].filter(quiet))
      if (all) for (const channel of yield* to.session.channels) ids.add(channel)
      // The first sync has not stored the conversations yet.
      if (all && ids.size === 0) yield* retryLater
      if (ids.size === 0) continue
      if (all) info.dirtyAll = false
      for (const id of ids) if (quiet(id)) info.dirty.delete(id)
      const read: Read = { all, ids, gap: info.gap, gens: new Map([...ids].map((id) => [id, info.frameGen.get(id) ?? 0])), at: now }
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
        info.connection = 'up'
        info.gap += 1
        return yield* markDue(to, 'all')
      case 'Disconnected':
        info.connection = 'down'
        info.gap += 1
        return
      case 'Overflowed':
        info.connection = 'unknown'
        info.gap += 1
        return yield* markDue(to, 'all')
    }
  }))
