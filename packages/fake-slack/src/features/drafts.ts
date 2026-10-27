import { ApiError, requireConversation } from '../methods.ts'
import type { FakeFeature } from './registry.ts'

/** Self's message drafts (`../drafts.ts`, research `slack-drafts.md`). */
export const draftsFeature = {
  methods: {
    'drafts.list': (ctx, args) => {
      const page = ctx.workspace.drafts.list({ isActive: args.is_active, limit: args.limit, nextTs: args.next_ts })
      return { drafts: [...page.drafts], has_more: page.hasMore }
    },
    'drafts.create': (ctx, args) => {
      const channel = args.destinations[0]?.channel_id
      if (channel !== undefined) {
        const conversation = requireConversation(ctx, channel)
        if (conversation instanceof ApiError) return new ApiError('invalid_channel')
      }
      const draft = ctx.workspace.drafts.create({ clientMsgId: args.client_msg_id, blocks: args.blocks, destinations: args.destinations, fileIds: args.file_ids, isFromComposer: args.is_from_composer })
      return typeof draft === 'string' ? new ApiError(draft) : { draft }
    },
    'drafts.update': (ctx, args) => {
      const draft = ctx.workspace.drafts.update({ draftId: args.draft_id, blocks: args.blocks, destinations: args.destinations, fileIds: args.file_ids, clientLastUpdatedTs: args.client_last_updated_ts })
      return typeof draft === 'string' ? new ApiError(draft) : { draft }
    },
    'drafts.info': (ctx, args) => {
      const draft = ctx.workspace.drafts.info(args.draft_id)
      return typeof draft === 'string' ? new ApiError(draft) : { draft }
    },
    'drafts.delete': (ctx, args) => {
      const failure = ctx.workspace.drafts.delete(args.draft_id, args.client_last_updated_ts)
      return failure === undefined ? {} : new ApiError(failure)
    },
  },
  controls: {
    putDraft: (fake, input) => fake.putDraft(input),
    removeDraft: (fake, input) => fake.removeDraft(input),
  },
} satisfies FakeFeature
