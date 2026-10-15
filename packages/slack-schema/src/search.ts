/**
 * `search.modules.messages`, used for thread discovery (`is:thread after:<date>`).
 *
 * The live module returns one message in each `items[].messages` array and
 * page-number pagination, without a cursor (research section 10, Live probe).
 * The decoder also tolerates the public API's flat matches and paging fields.
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks.ts'
import { FormNumber, ResponseMetadata } from './common.ts'
import { Ts } from './ts.ts'
import { Attachment, File } from './message.ts'

const opt = S.optionalKey

export const SearchMessagesArgs = S.Struct({
  module: S.Literal('messages'),
  query: S.String,
  page: opt(FormNumber),
  cursor: opt(S.String),
  count: opt(FormNumber),
  extracts: opt(FormNumber),
  highlight: opt(FormNumber),
  max_extract_len: opt(FormNumber),
  extra_message_data: opt(FormNumber),
  no_user_profile: opt(FormNumber),
  sort: opt(S.String),
  sort_dir: opt(S.String),
  client_req_id: opt(S.String),
  search_session_id: opt(S.String),
  browse_session_id: opt(S.String),
  query_rewrite_disabled: opt(FormNumber),
})
export type SearchMessagesArgs = typeof SearchMessagesArgs.Type

export const SearchChannel = S.Struct({
  id: S.String,
  name: opt(S.String),
  user: opt(S.String),
  is_archived: opt(S.Boolean),
  is_pending_ext_shared: opt(S.Boolean),
  pending_shared: opt(S.Array(S.String)),
  is_channel: opt(S.Boolean),
  is_group: opt(S.Boolean),
  is_im: opt(S.Boolean),
  is_mpim: opt(S.Boolean),
  is_private: opt(S.Boolean),
  is_shared: opt(S.Boolean),
  is_org_shared: opt(S.Boolean),
  is_ext_shared: opt(S.Boolean),
})

/** The fields of one matched message. */
const searchMessageFields = {
  iid: opt(S.String),
  type: opt(S.String),
  user: opt(S.String),
  username: opt(S.String),
  text: opt(S.String),
  permalink: opt(S.String),
  thread_ts: opt(Ts),
  reply_count: opt(S.Number),
  blocks: opt(Blocks),
  attachments: opt(S.Array(Attachment)),
  files: opt(S.Array(File)),
  score: opt(S.Number),
} as const

/** A message inside a module item (observed live: `items[].messages[]`, with `ts`, `text`, `user`, `username`, `permalink`, `iid`, sometimes `attachments`). */
export const SearchItemMessage = S.Struct({ ...searchMessageFields, ts: Ts })
export type SearchItemMessage = typeof SearchItemMessage.Type

/**
 * One result. Observed live (2026-10-13, `is:thread`, `sort=timestamp`):
 * the module API answers `items[]` of `{ channel, iid, team, messages[] }`,
 * the message fields inside `messages`. `extra_message_data=1` adds
 * `thread_ts` and root `reply_count`. The flat shape,
 * the fields on the item with a `ts`, is the public API's and the fake's
 * older one; both decode, and `searchMatches` flattens them.
 */
export const SearchMatch = S.Struct({
  iid: opt(S.String),
  team: opt(S.String),
  /** An object in the public API; a bare id is tolerated in case the module API differs. */
  channel: S.Union([SearchChannel, S.String]),
  messages: opt(S.Array(SearchItemMessage)),
  type: opt(S.String),
  user: opt(S.String),
  username: opt(S.String),
  ts: opt(Ts),
  text: opt(S.String),
  permalink: opt(S.String),
  thread_ts: opt(Ts),
  reply_count: opt(S.Number),
  blocks: opt(Blocks),
  attachments: opt(S.Array(Attachment)),
  files: opt(S.Array(File)),
  score: opt(S.Number),
  is_mpim: opt(S.Boolean),
})
export type SearchMatch = typeof SearchMatch.Type

export const SearchPagination = S.Struct({
  total_count: opt(S.Number),
  page: opt(S.Number),
  per_page: opt(S.Number),
  page_count: opt(S.Number),
  first: opt(S.Number),
  last: opt(S.Number),
})

export const SearchPaging = S.Struct({
  count: opt(S.Number),
  total: opt(S.Number),
  page: opt(S.Number),
  pages: opt(S.Number),
})

export const SearchMessagesFields = {
  query: opt(S.String),
  module: opt(S.String),
  items: opt(S.Array(SearchMatch)),
  messages: opt(S.Struct({ matches: S.Array(SearchMatch), total: opt(S.Number), pagination: opt(SearchPagination), paging: opt(SearchPaging) })),
  pagination: opt(SearchPagination),
  paging: opt(SearchPaging),
  total: opt(S.Number),
  filters: opt(S.Unknown),
  response_metadata: opt(ResponseMetadata),
} as const

type SearchMessagesOk = {
  readonly items?: ReadonlyArray<SearchMatch>
  readonly messages?: { readonly matches: ReadonlyArray<SearchMatch> }
}

/** A matched message with its conversation, whichever shape it came in. */
export type FlatSearchMatch = SearchItemMessage & { readonly channel: SearchMatch['channel']; readonly team?: string }

/** The matched messages of a search response wherever the server put them, one per message. */
export function searchMatches(response: SearchMessagesOk): ReadonlyArray<FlatSearchMatch> {
  const out: Array<FlatSearchMatch> = []
  for (const item of response.items ?? response.messages?.matches ?? []) {
    const { messages, channel, team, ts, ...fields } = item
    if (messages !== undefined) {
      for (const message of messages) out.push({ ...message, channel, ...(team === undefined ? {} : { team }) })
    } else if (ts !== undefined) {
      out.push({ ...fields, ts, channel, ...(team === undefined ? {} : { team }) })
    }
  }
  return out
}

export function searchMatchChannelId(match: Pick<SearchMatch, 'channel'>): string {
  return typeof match.channel === 'string' ? match.channel : match.channel.id
}
