import { Schema } from 'effect'
import { EdgeHuddlesInfoArgs, EdgeHuddlesInfoOk, ShRoomFrame, type RtmFrame } from '@juno/slack-schema'
import type { FakeSlack } from '../index.ts'
import { ApiError, requireConversation } from '../methods.ts'
import type { Workspace } from '../state.ts'
import type { FakeFeature } from './registry.ts'

/** One running huddle. `attendees` maps self's Chime attendee ids to self; other people join without one. */
interface FakeHuddle {
  readonly callId: string
  readonly channel: string
  readonly dateStart: number
  /** Who started it: the first to join. */
  readonly createdBy: string
  readonly participants: Array<string>
  readonly history: Array<string>
  readonly threadTs: string
  readonly attendees: Set<string>
}

interface Huddles {
  readonly byChannel: Map<string, FakeHuddle>
  /** Counters, so a call id or an attendee id is never given twice. */
  calls: number
  attendees: number
  /**
   * `v2` (`huddles_arch_v2`, the owner's workspace): `rooms.leave` answers
   * `feature_not_enabled` and changes nothing; an attendee leaves when its
   * Chime session stops (`stopMedia`). `v1`: `rooms.leave` removes it.
   */
  arch: 'v1' | 'v2'
  /** On v2, from the media stop to Slack's leave frame (the spike saw about a second). */
  leaveDelayMs: number
  /** On v2, how long a huddle with nobody left stays listed in `huddles/info`. */
  emptyDelayMs: number
  /** Self's `huddle_state_expiration_ts`, the one profile field the "In a huddle" status writes. */
  statusExpiresAt: number | undefined
  /**
   * How far `huddles/info` lags the room frames. Slack's edge answers from a
   * little while ago: the spike saw it list the user as active after the
   * room frame said they had left (research section 6).
   */
  infoLagMs: number
  /** What `huddles/info` would have answered after each change, oldest first, while `infoLagMs` is set. */
  readonly listed: Array<{ readonly at: number; readonly huddles: ReadonlyArray<Listed> }>
  /** How many more `rooms.join` answers carry a meeting without its media placement (`breakJoinMeeting`). */
  brokenJoins: number
}

/** One running huddle as `huddles/info` lists it. */
interface Listed {
  readonly call_id: string
  readonly channel_id: string
  readonly active_members: ReadonlyArray<string>
  readonly start_date: number
  readonly created_by: string
}

/** Keyed by workspace so two fakes never share huddles. */
const state = new WeakMap<Workspace, Huddles>()

function huddlesOf(ws: Workspace): Huddles {
  const existing = state.get(ws)
  if (existing !== undefined) return existing
  const created: Huddles = { byChannel: new Map(), calls: 0, attendees: 0, arch: 'v2', leaveDelayMs: 1_000, emptyDelayMs: 3_000, statusExpiresAt: undefined, infoLagMs: 0, listed: [], brokenJoins: 0 }
  state.set(ws, created)
  return created
}

const encodeFrame = Schema.encodeSync(ShRoomFrame)

const listedOf = (huddles: Huddles): ReadonlyArray<Listed> =>
  [...huddles.byChannel.values()].map((huddle) => ({ call_id: huddle.callId, channel_id: huddle.channel, active_members: [...huddle.participants], start_date: huddle.dateStart, created_by: huddle.createdBy }))

/** Keeps what `huddles/info` lists now, for a lagging answer later. */
function remember(ws: Workspace): void {
  const huddles = huddlesOf(ws)
  if (huddles.infoLagMs > 0) huddles.listed.push({ at: Date.now(), huddles: listedOf(huddles) })
}

/** What `huddles/info` answers now: the list as it was `infoLagMs` ago. */
function listedNow(ws: Workspace): ReadonlyArray<Listed> {
  const huddles = huddlesOf(ws)
  if (huddles.infoLagMs === 0) return listedOf(huddles)
  const by = Date.now() - huddles.infoLagMs
  return huddles.listed.findLast((entry) => entry.at <= by)?.huddles ?? []
}

/** Sends a room frame as Slack does: the whole room after the change. `RtmFrame` carries it as an unknown frame. */
function emitRoom(ws: Workspace, type: ShRoomFrame['type'], huddle: FakeHuddle, user: string | undefined, ended = false): void {
  remember(ws)
  const room = { id: huddle.callId, channels: [huddle.channel], participants: ended ? [] : [...huddle.participants],
    participant_history: [...huddle.history], date_start: huddle.dateStart,
    ...(ended ? { date_end: Math.floor(ws.clock.now() / 1000) } : {}),
    has_ended: ended, created_by: huddle.createdBy, thread_root_ts: huddle.threadTs }
  const message = ws.find(huddle.channel, huddle.threadTs)
  if (message !== undefined) {
    const updated = { ...message, subtype: 'sh_room_created', room }
    const list = ws.all(huddle.channel)
    list[list.indexOf(message)] = updated
    ws.emit({ ts: ws.eventTs(), type: 'message', subtype: 'message_changed', channel: huddle.channel, message: updated, event_ts: ws.eventTs() })
  }
  const raw = encodeFrame({
    type,
    ...(user === undefined ? {} : { user }),
    huddle: { channel_id: huddle.channel },
    room,
    event_ts: ws.eventTs(),
  })
  ws.emit({ type: 'unknown', raw } as RtmFrame)
}

function start(ws: Workspace, channel: string, user: string): FakeHuddle {
  const huddles = huddlesOf(ws)
  const existing = huddles.byChannel.get(channel)
  if (existing !== undefined) return existing
  huddles.calls += 1
  const message = ws.post({ channel, user, text: '', silent: true })
  const huddle: FakeHuddle = { callId: `R${String(huddles.calls).padStart(9, '0')}`, channel, dateStart: Math.floor(ws.clock.now() / 1000), createdBy: user, participants: [], history: [], threadTs: message.ts, attendees: new Set() }
  huddles.byChannel.set(channel, huddle)
  return huddle
}

function join(ws: Workspace, channel: string, user: string): FakeHuddle {
  const huddle = start(ws, channel, user)
  if (!huddle.history.includes(user)) huddle.history.push(user)
  if (!huddle.participants.includes(user)) huddle.participants.push(user)
  emitRoom(ws, 'sh_room_join', huddle, user)
  return huddle
}

function leave(ws: Workspace, huddle: FakeHuddle, user: string): void {
  const at = huddle.participants.indexOf(user)
  if (at < 0) return
  huddle.participants.splice(at, 1)
  const ended = huddle.participants.length === 0
  emitRoom(ws, 'sh_room_leave', huddle, user, ended)
  if (!ended) return
  const huddles = huddlesOf(ws)
  // As the spike saw on v2: listed with nobody in it for a few seconds, then gone.
  const drop = () => {
    if (huddles.byChannel.get(huddle.channel) === huddle && huddle.participants.length === 0) huddles.byChannel.delete(huddle.channel)
    remember(ws)
  }
  if (huddles.arch === 'v1') drop()
  else setTimeout(drop, huddles.emptyDelayMs).unref()
}

/** Self's attendee leaves the meeting: self leaves the huddle once it holds no other attendee there. */
function attendeeGone(ws: Workspace, huddle: FakeHuddle, attendeeId: string): boolean {
  if (!huddle.attendees.delete(attendeeId)) return false
  if (huddle.attendees.size === 0) leave(ws, huddle, ws.selfId)
  return true
}

function running(fake: FakeSlack, channel: string): FakeHuddle {
  const huddle = huddlesOf(fake.workspace).byChannel.get(channel)
  if (huddle === undefined) throw new Error(`no huddle in ${channel}`)
  return huddle
}

/**
 * Huddles (docs/research/slack-huddles.md sections 2 and 6).
 *
 * `rooms.join` starts a huddle in the channel when none runs, adds self and
 * answers with a fake Chime meeting and a fresh attendee in the shape the
 * spike recorded (`call.free_willy`). Nothing listens at its urls: tests use
 * the fake media session, never Chime. On arch v2, the default as on the
 * owner's workspace, `rooms.leave` answers `feature_not_enabled` and the
 * attendee leaves when its media stops (`stopMedia`); on v1 `rooms.leave`
 * removes it. Self leaves once they hold no attendee; the last one out ends
 * the huddle. Each change sends its room frame. The edge `huddles/info`
 * lists the running huddles of the channels asked for. `users.profile.set`
 * keeps self's huddle status expiry, or sets self's own status.
 *
 * Controls: `setHuddleArch`, `stopMedia` (Chime dropped self's attendee),
 * `huddleStatus` (self's status expiry), `startHuddle` and `joinHuddle`
 * (another user starts or joins), `leaveHuddle` (another user leaves) and
 * `endHuddle` (the huddle ends for everyone, as a room update with
 * `has_ended`). `setHuddleInfoLag` makes `huddles/info` answer from a
 * while ago, as Slack's edge does. `breakJoinMeeting` makes the next
 * `rooms.join` answers carry a meeting Chime cannot use.
 */
export const huddlesFeature = {
  methods: {
    'rooms.join': (ctx, args) => {
      const conversation = requireConversation(ctx, args.channel_id, true)
      if (conversation instanceof ApiError) return new ApiError('rooms_invalid_channel')
      const ws = ctx.workspace
      const huddles = huddlesOf(ws)
      huddles.attendees += 1
      const attendeeId = `fake-attendee-${huddles.attendees}`
      const huddle = start(ws, conversation.id, ws.selfId)
      huddle.attendees.add(attendeeId)
      join(ws, conversation.id, ws.selfId)
      const host = 'fake-chime.invalid'
      const broken = huddles.brokenJoins > 0
      if (broken) huddles.brokenJoins -= 1
      return {
        call: {
          call_id: huddle.callId,
          free_willy: {
            meeting: {
              MeetingId: `fake-meeting-${huddle.callId}`,
              ExternalMeetingId: `${ws.team.id}-${huddle.callId}`,
              MediaRegion: args.regions?.[0] ?? 'us-east-1',
              ...(broken
                ? {}
                : {
                    MediaPlacement: {
                      AudioHostUrl: `${host}:3478`,
                      SignalingUrl: `wss://${host}/control`,
                      TurnControlUrl: `https://${host}/v2/turn_sessions`,
                      EventIngestionUrl: `https://${host}/v2/client-events`,
                    },
                  }),
            },
            // As recorded: team id, room id, user id.
            attendee: { AttendeeId: attendeeId, ExternalUserId: `${ws.team.id}-${huddle.callId}-${ws.selfId}`, JoinToken: 'fake-join-token' },
          },
        },
        huddle: { id: huddle.callId, channels: [conversation.id], participants: [...huddle.participants], date_start: huddle.dateStart, created_by: huddle.createdBy },
      }
    },
    // The huddle's expiry, or the user's own status (Slack sends `user_change` after it).
    'users.profile.set': (ctx, args) => {
      const profile = args.profile
      if ('huddle_state_expiration_ts' in profile) huddlesOf(ctx.workspace).statusExpiresAt = profile.huddle_state_expiration_ts
      else ctx.workspace.setStatus(ctx.workspace.selfId, { text: profile.status_text, emoji: profile.status_emoji, expiration: profile.status_expiration })
      return {}
    },
    'rooms.leave': (ctx, args) => {
      const huddles = huddlesOf(ctx.workspace)
      if (huddles.arch === 'v2') return new ApiError('feature_not_enabled')
      const huddle = huddles.byChannel.get(args.channel_id)
      if (huddle === undefined || huddle.callId !== args.call_id) return new ApiError('room_not_found')
      if (!attendeeGone(ctx.workspace, huddle, args.attendee_id)) return new ApiError('attendee_not_found')
      return {}
    },
  },
  edge: {
    'huddles/info': (ctx, body) => {
      const args = Schema.decodeUnknownSync(EdgeHuddlesInfoArgs)(body)
      const asked = new Set(args.channel_ids)
      const huddles = listedNow(ctx.workspace).filter((huddle) => asked.has(huddle.channel_id))
      return Schema.encodeSync(EdgeHuddlesInfoOk)({ ok: true, huddles })
    },
  },
  controls: {
    /** The next `times` `rooms.join` answers (default 1) carry a meeting without its media placement, which Chime's session rejects. */
    breakJoinMeeting: (fake, input: { times?: number }) => {
      huddlesOf(fake.workspace).brokenJoins = input.times ?? 1
    },
    /** Self's huddle status expiry in epoch seconds, or null before any was set. */
    huddleStatus: (fake) => huddlesOf(fake.workspace).statusExpiresAt ?? null,
    /** `arch`, and on v2 the two delays (see `Huddles`). */
    setHuddleArch: (fake, input: { arch: 'v1' | 'v2'; leaveDelayMs?: number; emptyDelayMs?: number }) => {
      const huddles = huddlesOf(fake.workspace)
      huddles.arch = input.arch
      if (input.leaveDelayMs !== undefined) huddles.leaveDelayMs = input.leaveDelayMs
      if (input.emptyDelayMs !== undefined) huddles.emptyDelayMs = input.emptyDelayMs
    },
    /** `huddles/info` answers as Slack's edge did `ms` ago (see `Huddles.infoLagMs`); 0 answers now. */
    setHuddleInfoLag: (fake, input: { ms: number }) => {
      const huddles = huddlesOf(fake.workspace)
      huddles.infoLagMs = input.ms
      huddles.listed.splice(0, huddles.listed.length, { at: Date.now(), huddles: listedOf(huddles) })
    },
    /**
     * Chime drops self's attendee: the media session stopped (a leave, a
     * crash, another device). On v2 this is what removes it from the
     * huddle, after `leaveDelayMs`; on v1 it does too, at once.
     */
    stopMedia: (fake, input: { attendeeId: string }) => {
      const huddles = huddlesOf(fake.workspace)
      const huddle = [...huddles.byChannel.values()].find((h) => h.attendees.has(input.attendeeId))
      if (huddle === undefined) return false
      if (huddles.arch === 'v1') return attendeeGone(fake.workspace, huddle, input.attendeeId)
      setTimeout(() => attendeeGone(fake.workspace, huddle, input.attendeeId), huddles.leaveDelayMs).unref()
      return true
    },
    startHuddle: (fake, input: { channel: string; user?: string }) => join(fake.workspace, input.channel, input.user ?? 'U0MAYA').callId,
    joinHuddle: (fake, input: { channel: string; user?: string }) => {
      running(fake, input.channel)
      join(fake.workspace, input.channel, input.user ?? 'U0MAYA')
    },
    leaveHuddle: (fake, input: { channel: string; user?: string }) => leave(fake.workspace, running(fake, input.channel), input.user ?? 'U0MAYA'),
    endHuddle: (fake, input: { channel: string }) => {
      const huddle = running(fake, input.channel)
      huddlesOf(fake.workspace).byChannel.delete(input.channel)
      emitRoom(fake.workspace, 'sh_room_update', huddle, undefined, true)
      huddle.participants.splice(0)
      huddle.attendees.clear()
      remember(fake.workspace)
    },
  },
} satisfies FakeFeature
