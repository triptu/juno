/**
 * `search.modules.messages`, used for thread discovery (`is:thread after:<date>`).
 *
 * The response shape is partly Unknown (research section 3; architecture 5.3):
 * matches may come as `items` or as `messages.matches`, and paging may be by
 * `page` or `cursor`. Everything uncertain is optional and `searchMatches`
 * hides the difference. The fake answers with `items` + `pagination` and a
 * `response_metadata.next_cursor`.
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks.ts'
import { FormNumber, ResponseMetadata, Ts } from './common.ts'
import { Attachment, File } from './message.ts'

const opt = S.optionalKey

export const SearchModule = S.Literals([
  'messages',
  'files',
  'people',
  'channels',
  'dms',
  'shortcuts',
  'workflows',
  'salesforce',
  'agents',
  'default',
])

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
  is_channel: opt(S.Boolean),
  is_group: opt(S.Boolean),
  is_im: opt(S.Boolean),
  is_mpim: opt(S.Boolean),
  is_private: opt(S.Boolean),
  is_shared: opt(S.Boolean),
  is_org_shared: opt(S.Boolean),
  is_ext_shared: opt(S.Boolean),
})

export const SearchMatch = S.Struct({
  iid: opt(S.String),
  team: opt(S.String),
  /** An object in the public API; a bare id is tolerated in case the module API differs. */
  channel: S.Union([SearchChannel, S.String]),
  type: opt(S.String),
  user: opt(S.String),
  username: opt(S.String),
  ts: Ts,
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

/** The matches of a search response wherever the server put them. */
export function searchMatches(response: SearchMessagesOk): ReadonlyArray<SearchMatch> {
  return response.items ?? response.messages?.matches ?? []
}

export function searchMatchChannelId(match: Pick<SearchMatch, 'channel'>): string {
  return typeof match.channel === 'string' ? match.channel : match.channel.id
}
