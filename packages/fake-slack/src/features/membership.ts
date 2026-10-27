/**
 * Joining and leaving channels (`conversations.join`, `conversations.leave`).
 * They refuse as Slack's public docs list it (research section 3, "Joining
 * and leaving channels"). Self gets `channel_joined` or `channel_left` and
 * everyone `member_joined_channel` or `member_left_channel` (`Workspace.join`
 * and `leave`). The `joinChannel` and `leaveChannel` controls are another
 * client doing the same.
 */
import { ApiError } from '../methods.ts'
import type { FakeFeature } from './registry.ts'

export const membershipFeature = {
  methods: {
    'conversations.join': (ctx, args) => {
      const ws = ctx.workspace
      const conversation = ws.conversation(args.channel)
      if (conversation === undefined) return new ApiError('channel_not_found')
      if (conversation.kind !== 'public') return new ApiError('method_not_supported_for_channel_type')
      if (conversation.archived) return new ApiError('is_archived')
      if (conversation.members.has(ws.selfId)) return { channel: ws.channelObject(conversation), already_in_channel: true }
      ws.join(args.channel, ws.selfId)
      return { channel: ws.channelObject(conversation) }
    },
    'conversations.leave': (ctx, args) => {
      const ws = ctx.workspace
      const conversation = ws.conversation(args.channel)
      if (conversation === undefined) return new ApiError('channel_not_found')
      if (conversation.kind === 'im' || conversation.kind === 'mpim') return new ApiError('method_not_supported_for_channel_type')
      if (conversation.name === 'general') return new ApiError('cant_leave_general')
      if (conversation.archived) return new ApiError('is_archived')
      if (!conversation.members.has(ws.selfId)) return { not_in_channel: true }
      if (conversation.kind === 'private' && conversation.members.size === 1) return new ApiError('last_member')
      ws.leave(args.channel, ws.selfId)
      return {}
    },
  },
  controls: {},
} satisfies FakeFeature
