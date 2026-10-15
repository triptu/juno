/**
 * `search.slack`: Slack's message search for the palette (spec section 2,
 * "everything stays reachable from ⌘K"), for messages older than the local
 * cache. It calls `search.modules.messages` on the interactive lane and
 * stores nothing: the palette shows the matches, and opening one fetches
 * its page through the usual open path.
 *
 * Ranking without `sort` and the rate tier while typing remain unknown
 * (research section 10, Live probe).
 */
import { SLACK_SEARCH_MAX } from '@juno/contract'
import { searchMessages, type SlackApiShape } from '@juno/slack'
import { StoreReader } from '@juno/store'
import { Effect } from 'effect'
import { messageResults, topicOfMessage } from './query'

export const searchSlack = (api: SlackApiShape, query: string) =>
  Effect.gen(function* () {
    const text = query.trim()
    if (text === '') return []
    const answer = yield* Effect.result(searchMessages(api, text, SLACK_SEARCH_MAX))
    if (answer._tag === 'Failure') {
      yield* Effect.logWarning(`search.slack: ${answer.failure._tag}`)
      return []
    }
    const matches = answer.success
    if (matches.length === 0) return []
    const sql = yield* StoreReader
    const channels = [...new Set(matches.map((match) => match.channel))]
    // Search also covers public channels the user is not in; those, and ignored channels, are dropped.
    const visible = new Set(
      (yield* sql<{ id: string }>`SELECT c.id FROM conversations c LEFT JOIN ignored_channels g ON g.channel = c.id
        WHERE c.id IN ${sql.in(channels)} AND c.is_member = 1 AND g.channel IS NULL`).map((row) => row.id),
    )
    const shown = matches.filter((match) => visible.has(match.channel))
    if (shown.length === 0) return []
    const stored = new Map(
      (yield* sql<{ channel: string; ts: string; thread_ts: string | null; reply_count: number; deleted: number }>`SELECT channel, ts, thread_ts, reply_count, deleted FROM messages
        WHERE channel IN ${sql.in([...new Set(shown.map((match) => match.channel))])} AND ts IN ${sql.in([...new Set(shown.map((match) => match.ts))])}`).map((row) => [`${row.channel}:${row.ts}`, row]),
    )
    const hits = []
    const seen = new Set<string>()
    for (const match of shown) {
      const key = `${match.channel}:${match.ts}`
      const row = stored.get(key)
      if (seen.has(key) || row?.deleted === 1) continue
      seen.add(key)
      const topicId = row !== undefined ? topicOfMessage(match.channel, match.ts, row.thread_ts, row.reply_count) : topicOfMessage(match.channel, match.ts, match.threadTs ?? null, match.replyCount ?? 0)
      hits.push({ channel: match.channel, ts: match.ts, thread_ts: null, reply_count: 0, user_id: match.user ?? null, username: match.username, text: match.text, attachments_json: JSON.stringify(match.attachments), blocks_json: JSON.stringify(match.blocks), topicId, stored: row !== undefined })
    }
    return yield* messageResults(hits)
  })
