import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'

export const SearchResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('topic'), id: Schema.String, channelId: Schema.String, title: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('message'), id: Schema.String, topicId: Schema.String, channelId: Schema.String, ts: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('channel'), id: Schema.String, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('person'), id: Schema.String, name: Schema.String }),
])
export type SearchResult = typeof SearchResult.Type

/** Local search only. Empty text returns recent topics. The engine caps limit at 50. */
export const searchQuery = liveValueRoute('search.query', {
  payload: { query: Schema.String, limit: Schema.optionalKey(Schema.Int) },
  value: Schema.Array(SearchResult),
})
export const SearchRoutes = RpcGroup.make(searchQuery)
