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
  readonly participants: Array<string>
  readonly attendees: Set<string>
}

interface Huddles {
  readonly byChannel: Map<string, FakeHuddle>
  /** Counters, so a call id or an attendee id is never given twice. */
  calls: number
  attendees: number
}

/** Keyed by workspace so two fakes never share huddles. */
const state = new WeakMap<Workspace, Huddles>()

function huddlesOf(ws: Workspace): Huddles {
  const existing = state.get(ws)
  if (existing !== undefined) return existing
  const created: Huddles = { byChannel: new Map(), calls: 0, attendees: 0 }
  state.set(ws, created)
  return created
}

const encodeFrame = Schema.encodeSync(ShRoomFrame)

/** Sends a room frame as Slack does: the whole room after the change. `RtmFrame` carries it as an unknown frame. */
function emitRoom(ws: Workspace, type: ShRoomFrame['type'], huddle: FakeHuddle, user: string | undefined, ended = false): void {
  const raw = encodeFrame({
    type,
    ...(user === undefined ? {} : { user }),
    huddle: { channel_id: huddle.channel },
    room: { id: huddle.callId, channels: [huddle.channel], participants: ended ? [] : [...huddle.participants], date_start: huddle.dateStart, has_ended: ended },
    event_ts: ws.eventTs(),
  })
  ws.emit({ type: 'unknown', raw } as RtmFrame)
}

function start(ws: Workspace, channel: string): FakeHuddle {
  const huddles = huddlesOf(ws)
  const existing = huddles.byChannel.get(channel)
  if (existing !== undefined) return existing
  huddles.calls += 1
  const huddle: FakeHuddle = { callId: `R${String(huddles.calls).padStart(9, '0')}`, channel, dateStart: Math.floor(ws.clock.now() / 1000), participants: [], attendees: new Set() }
  huddles.byChannel.set(channel, huddle)
  return huddle
}

function join(ws: Workspace, channel: string, user: string): FakeHuddle {
  const huddle = start(ws, channel)
  if (!huddle.participants.includes(user)) huddle.participants.push(user)
  emitRoom(ws, 'sh_room_join', huddle, user)
  return huddle
}

function leave(ws: Workspace, huddle: FakeHuddle, user: string): void {
  const at = huddle.participants.indexOf(user)
  if (at < 0) return
  huddle.participants.splice(at, 1)
  const ended = huddle.participants.length === 0
  if (ended) huddlesOf(ws).byChannel.delete(huddle.channel)
  emitRoom(ws, 'sh_room_leave', huddle, user, ended)
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
 * the fake media session, never Chime. `rooms.leave` removes the attendee,
 * and self once they hold none; the last one out ends the huddle. Each
 * change sends its room frame. The edge `huddles/info` lists the running
 * huddles of the channels asked for.
 *
 * Controls: `startHuddle` and `joinHuddle` (another user starts or joins),
 * `leaveHuddle` (another user leaves) and `endHuddle` (the huddle ends for
 * everyone, as a room update with `has_ended`).
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
      const huddle = start(ws, conversation.id)
      huddle.attendees.add(attendeeId)
      join(ws, conversation.id, ws.selfId)
      const host = 'fake-chime.invalid'
      return {
        call: {
          call_id: huddle.callId,
          free_willy: {
            meeting: {
              MeetingId: `fake-meeting-${huddle.callId}`,
              ExternalMeetingId: `${ws.team.id}-${huddle.callId}`,
              MediaRegion: args.regions?.[0] ?? 'us-east-1',
              MediaPlacement: {
                AudioHostUrl: `${host}:3478`,
                SignalingUrl: `wss://${host}/control`,
                TurnControlUrl: `https://${host}/v2/turn_sessions`,
                EventIngestionUrl: `https://${host}/v2/client-events`,
              },
            },
            // As recorded: team id, room id, user id.
            attendee: { AttendeeId: attendeeId, ExternalUserId: `${ws.team.id}-${huddle.callId}-${ws.selfId}`, JoinToken: 'fake-join-token' },
          },
        },
        huddle: { id: huddle.callId, channels: [conversation.id], participants: [...huddle.participants], date_start: huddle.dateStart },
      }
    },
    'rooms.leave': (ctx, args) => {
      const huddle = huddlesOf(ctx.workspace).byChannel.get(args.channel_id)
      if (huddle === undefined || huddle.callId !== args.call_id) return new ApiError('room_not_found')
      if (!huddle.attendees.delete(args.attendee_id)) return new ApiError('attendee_not_found')
      if (huddle.attendees.size === 0) leave(ctx.workspace, huddle, ctx.workspace.selfId)
      return {}
    },
  },
  edge: {
    'huddles/info': (ctx, body) => {
      const args = Schema.decodeUnknownSync(EdgeHuddlesInfoArgs)(body)
      const byChannel = huddlesOf(ctx.workspace).byChannel
      const huddles = args.channel_ids.flatMap((channel) => {
        const huddle = byChannel.get(channel)
        return huddle === undefined ? [] : [{ call_id: huddle.callId, channel_id: channel, active_members: [...huddle.participants], start_date: huddle.dateStart }]
      })
      return Schema.encodeSync(EdgeHuddlesInfoOk)({ ok: true, huddles })
    },
  },
  controls: {
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
    },
  },
} satisfies FakeFeature
