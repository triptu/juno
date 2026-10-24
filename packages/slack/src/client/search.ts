/**
 * Slack's message search as a list of plain matches, for the palette
 * (`search.modules.messages`, research section 10). Whatever shape the
 * answer comes in (`items[].messages[]` live, flat matches in the public
 * API), each match is one message with its conversation and, when Slack
 * says, its thread.
 */
import { searchMatchChannelId, searchMatches, type FlatSearchMatch, type SearchMessagesArgs } from '@juno/slack-schema'
import { Effect } from 'effect'
import type { SlackApiShape } from './api.ts'
import type { SlackApiError } from './errors.ts'

export interface MessageMatch {
  readonly channel: string
  readonly ts: string
  readonly user?: string
  readonly username?: string
  readonly botName?: string
  readonly attachments?: FlatSearchMatch['attachments']
  readonly blocks?: FlatSearchMatch['blocks']
  readonly text: string
  /** From the match, else from its permalink's `thread_ts` parameter when extra message data is unavailable. */
  readonly threadTs?: string
  readonly replyCount?: number
}

function threadTsOf(match: FlatSearchMatch): string | undefined {
  if (match.thread_ts !== undefined) return match.thread_ts
  return match.permalink === undefined ? undefined : /[?&]thread_ts=(\d+\.\d+)/.exec(match.permalink)?.[1]
}

/** The first page of matches for `query`, in Slack's order, on the interactive lane. */
export const searchMessages = (api: SlackApiShape, query: string, count: number): Effect.Effect<ReadonlyArray<MessageMatch>, SlackApiError> =>
  Effect.map(
    api.call('search.modules.messages', { module: 'messages', query, count, page: 1, no_user_profile: 1, extra_message_data: 1 }, { lane: 'interactive', reason: 'palette' }),
    (answer) =>
      searchMatches(answer).map((match) => {
        const threadTs = threadTsOf(match)
        const botName = match.bot_id || match.bot_profile || match.subtype === 'bot_message' ? match.bot_profile?.name || match.username || match.attachments?.find((a) => a.author_name)?.author_name : undefined
        return {
          channel: searchMatchChannelId(match),
          ts: match.ts,
          text: match.text ?? '',
          ...(botName === undefined ? {} : { botName }),
          ...(match.attachments === undefined ? {} : { attachments: match.attachments }),
          ...(match.blocks === undefined ? {} : { blocks: match.blocks }),
          ...(match.user === undefined ? {} : { user: match.user }),
          ...(match.username === undefined ? {} : { username: match.username }),
          ...(threadTs === undefined ? {} : { threadTs }),
          ...(match.reply_count === undefined ? {} : { replyCount: match.reply_count }),
        }
      }),
  )

export type SearchPageArgs = SearchMessagesArgs
export type SearchPageMatch = FlatSearchMatch & { readonly channel: string }
/** Full page metadata and facets survive decoding for Search sessions. */
export const searchMessagePage = (api: SlackApiShape, args: SearchPageArgs) =>
  api.call('search.modules.messages', args, { lane: 'interactive', reason: 'search' }).pipe(Effect.map((answer) => ({
    matches: searchMatches(answer).map((match): SearchPageMatch => ({ ...match, channel: searchMatchChannelId(match) })),
    pagination: answer.pagination,
    total: answer.pagination?.total_count ?? answer.total,
    facets: answer.filter_suggestions,
  })))
