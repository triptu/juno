import { ApiError, requireConversation } from '../methods.ts'
import type { Workspace } from '../state.ts'
import type { FakeFeature } from './registry.ts'

/** One live call per channel, and the attendees self holds in it. Keyed by workspace so two fakes never share calls. */
const calls = new WeakMap<Workspace, Map<string, { callId: string; attendees: Set<string> }>>()

/**
 * `rooms.join` answers with a fake Chime meeting and attendee in the shape
 * the research records (`call.free_willy`). Nothing listens at its urls:
 * tests use the fake media session, never Chime.
 */
export const huddlesFeature = {
  methods: {
    'rooms.join': (ctx, args) => {
      const conversation = requireConversation(ctx, args.channel_id, true)
      if (conversation instanceof ApiError) return new ApiError('rooms_invalid_channel')
      const ws = ctx.workspace
      const byChannel = calls.get(ws) ?? new Map()
      calls.set(ws, byChannel)
      const call = byChannel.get(conversation.id) ?? { callId: `R${String(byChannel.size + 1).padStart(9, '0')}`, attendees: new Set<string>() }
      byChannel.set(conversation.id, call)
      const attendeeId = `fake-attendee-${call.attendees.size + 1}`
      call.attendees.add(attendeeId)
      const host = 'fake-chime.invalid'
      return {
        call: {
          call_id: call.callId,
          free_willy: {
            meeting: {
              MeetingId: `fake-meeting-${call.callId}`,
              ExternalMeetingId: `${ws.team.id}-${call.callId}`,
              MediaRegion: args.regions?.[0] ?? 'us-east-1',
              MediaPlacement: {
                AudioHostUrl: `${host}:3478`,
                SignalingUrl: `wss://${host}/control`,
                TurnControlUrl: `https://${host}/v2/turn_sessions`,
                EventIngestionUrl: `https://${host}/v2/client-events`,
              },
            },
            attendee: { AttendeeId: attendeeId, ExternalUserId: `${ws.selfId}#${attendeeId}`, JoinToken: 'fake-join-token' },
          },
        },
        huddle: { channels: [conversation.id] },
      }
    },
    'rooms.leave': (ctx, args) => {
      const call = calls.get(ctx.workspace)?.get(args.channel_id)
      if (call === undefined || call.callId !== args.call_id) return new ApiError('room_not_found')
      if (!call.attendees.delete(args.attendee_id)) return new ApiError('attendee_not_found')
      if (call.attendees.size === 0) calls.get(ctx.workspace)?.delete(args.channel_id)
      return {}
    },
  },
  controls: {},
} satisfies FakeFeature
