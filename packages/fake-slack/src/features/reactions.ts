import type { MethodArgs } from '@juno/slack-schema'
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
