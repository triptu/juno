import { compareTs, type ActivityFeedItem, type MethodArgs, type Ts } from '@juno/slack-schema'
import { isKnownReaction } from '../emojiNames.ts'
import { ApiError, requireConversation, type MethodContext, type MethodResult } from '../methods.ts'
import { withListedReactors } from '../reactors.ts'
import type { FakeFeature } from './registry.ts'

export const reactionsFeature = {
  methods: {
    'reactions.add': (ctx, args) => reaction(ctx, args, true),
    'reactions.remove': (ctx, args) => reaction(ctx, args, false),
    'reactions.get': (ctx, args) => {
      const conversation = requireConversation(ctx, args.channel)
      if (conversation instanceof ApiError) return conversation
      const message = ctx.workspace.find(args.channel, args.timestamp)
      if (message === undefined) return new ApiError('message_not_found')
      // Without `full`, cut as pages are (`reactors.ts`).
      const shown = args.full === true ? message : withListedReactors(message)
      return { message: shown.reactions === undefined ? {} : { reactions: shown.reactions } }
    },
    'activity.feed': (ctx, args) => {
      // Slack refuses a page over 50 (research `activity-feed.md`); only reactions are modelled.
      const limit = args.limit ?? 20
      if (limit > FEED_LIMIT) return new ApiError('invalid_arguments')
      const all = args.types.split(',').includes('message_reaction') ? reactionFeed(ctx) : []
      const after = all.filter((item) => args.cursor === undefined || args.cursor === '' || compareTs(item.feed_ts as Ts, args.cursor as Ts) < 0)
      const page = after.slice(0, limit)
      const more = after.length > limit
      return { items: page, response_metadata: { next_cursor: more ? page.at(-1)!.feed_ts : '' } }
    },
  },
  controls: {
    addReaction: (fake, input) => fake.addReaction(input),
    removeReaction: (fake, input) => fake.removeReaction(input),
    seedManyReactions: (fake, input) => fake.seedManyReactions(input),
  },
} satisfies FakeFeature

function reaction(ctx: MethodContext, args: MethodArgs<'reactions.add'>, add: boolean): MethodResult<'reactions.add'> {
  const ws = ctx.workspace
  const conversation = requireConversation(ctx, args.channel, true)
  if (conversation instanceof ApiError) return conversation
  if (ws.find(args.channel, args.timestamp) === undefined) return new ApiError('message_not_found')
  if (!isKnownReaction(args.name, new Set(ws.emoji.keys()))) return new ApiError('invalid_name')
  const failure = ws.react(args.channel, args.timestamp, args.name, ws.selfId, add)
  return failure === undefined ? {} : new ApiError(failure)
}

const FEED_LIMIT = 50

/**
 * One entry per message of self's in a conversation self is in that someone
 * else has reacted to, newest first by the latest such reaction, as Slack's
 * `activity.feed` with `types=message_reaction` (research `activity-feed.md`).
 * A seeded reaction has no time of its own: the message's ts stands in.
 */
function reactionFeed(ctx: MethodContext): Array<ActivityFeedItem> {
  const ws = ctx.workspace
  const items: Array<ActivityFeedItem> = []
  for (const [channel, record] of ws.conversations) {
    if (!record.members.has(ws.selfId)) continue
    for (const message of ws.all(channel)) {
      if (message.user !== ws.selfId) continue
      const others = (message.reactions ?? []).flatMap((reaction) => (reaction.users ?? []).filter((user) => user !== ws.selfId).map((user) => ({ user, name: reaction.name })))
      if (others.length === 0) continue
      const latest = ws.latestReaction.get(`${channel}:${message.ts}`)
      const reaction = latest !== undefined && others.some((other) => other.user === latest.user && other.name === latest.name) ? latest : others.at(-1)!
      const feedTs = latest?.at ?? message.ts
      items.push({
        feed_ts: feedTs,
        is_unread: false,
        is_archived: false,
        key: `message_reaction-${channel}-${message.ts}-${feedTs}`,
        item: { type: 'message_reaction', message: { channel, ts: message.ts }, reaction: { name: reaction.name, user: reaction.user } },
      })
    }
  }
  return items.toSorted((a, b) => compareTs(b.feed_ts as Ts, a.feed_ts as Ts))
}
