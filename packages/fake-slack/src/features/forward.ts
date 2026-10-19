import type { Message, MethodArgs } from '@juno/slack-schema'
import { isReply, permalinkPath } from '@juno/slack-schema'
import { ApiError, requireConversation, type MethodContext, type MethodResult } from '../methods.ts'
import { blocksToText } from '../richtext.ts'
import type { FakeFeature } from './registry.ts'

/**
 * Forwarding, as Slack does it for the official client's Forward dialog
 * (research `slack-forward.md`): one new message by self in the
 * destination, with the note as its blocks and the forwarded message as
 * one shared-message attachment, sent with the same events as a post.
 */
export const forwardFeature = {
  methods: {
    'chat.shareMessage': (ctx, args) => share(ctx, args),
  },
  controls: {},
} satisfies FakeFeature

function share(ctx: MethodContext, args: MethodArgs<'chat.shareMessage'>): MethodResult<'chat.shareMessage'> {
  const ws = ctx.workspace
  const from = requireConversation(ctx, args.channel)
  if (from instanceof ApiError) return from
  const source = ws.find(args.channel, args.timestamp)
  if (source === undefined) return new ApiError('message_not_found')
  // A user id is not a conversation: the client opens the DM first.
  const to = requireConversation(ctx, args.share_channel, true)
  if (to instanceof ApiError) return to
  if (to.archived) return new ApiError('is_archived')
  const note = args.blocks === undefined || args.blocks.length === 0 ? undefined : args.blocks
  const message = ws.post({
    channel: args.share_channel,
    user: ws.selfId,
    ...(note === undefined ? {} : { text: blocksToText(note), blocks: note }),
    attachments: [sharedAttachment(ctx, args.channel, source)],
    clientMsgId: args.client_msg_id,
  })
  return { channel: args.share_channel, ts: message.ts }
}

/**
 * The attachment Slack builds for a forwarded message, with the fields
 * Juno's schema reads. Slack also sends `author_id`, `channel_team` and
 * `is_reply_unfurl` or `is_thread_root_unfurl`, which the schema drops.
 */
function sharedAttachment(ctx: MethodContext, channel: string, source: Message): NonNullable<Message['attachments']>[number] {
  const ws = ctx.workspace
  const user = source.user === undefined ? undefined : ws.users.get(source.user)
  const name = user?.profile?.display_name || user?.real_name || user?.name || ''
  const conversation = ws.conversation(channel)
  const where = conversation?.kind === 'public' || conversation?.kind === 'private' ? `#${conversation.name}` : 'a direct message'
  const inThread = isReply(source) || (source.reply_count ?? 0) > 0
  return {
    id: 1,
    is_share: true,
    is_msg_unfurl: true,
    color: 'D0D0D0',
    ts: source.ts,
    channel_id: channel,
    author_name: name,
    ...(user?.profile?.image_48 === undefined ? {} : { author_icon: user.profile.image_48 }),
    author_link: `${ctx.baseUrl}/team/${source.user ?? ''}`,
    from_url: `${ctx.baseUrl}${permalinkPath(channel, source.ts, source.thread_ts)}`,
    // A message of only files, as seen live: its files and no words, and a fallback that names the files.
    fallback: `[${source.ts}] ${name}: ${source.text || (source.files ?? []).map((file) => file.name ?? file.id).join(', ')}`,
    ...(source.text ? { text: source.text } : {}),
    mrkdwn_in: ['text'],
    ...(source.blocks === undefined ? {} : { blocks: source.blocks }),
    ...(source.files === undefined || source.files.length === 0 ? {} : { files: source.files }),
    footer: `${inThread ? 'Thread in' : 'Posted in'} ${where}`,
  }
}
