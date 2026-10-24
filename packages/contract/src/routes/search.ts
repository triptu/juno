export { searchRanges } from '@juno/domain'
/** Local palette search, paged Search sessions, and the existing command reader. */
import { Schema } from 'effect'
import { SearchQuery } from '@juno/domain'
export { SearchQuery, parseSearchQuery, printSearchQuery } from '@juno/domain'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'
import { ChannelRef, Person } from '../refs'

/** Where a result lives, without the DM partner's or group members' ids. */
const { partnerId: _partnerId, memberIds: _memberIds, ...placeFields } = ChannelRef.fields
export const SearchPlace = Schema.Struct(placeFields)
export type SearchPlace = typeof SearchPlace.Type

/** A matched part of a text, in UTF-16 offsets. */
export const SearchRange = Schema.Struct({ start: Schema.Int, end: Schema.Int })

export const SearchTopic = Schema.Struct({
  kind: Schema.Literal('topic'),
  id: Schema.String,
  /** The topic's title; "#eng · Main" for a Main. */
  title: Schema.String,
  place: SearchPlace,
  /** Epoch milliseconds of the latest activity. */
  at: Schema.Number,
  /** The parts of `title` the text matched (`search.query`). */
  ranges: Schema.optionalKey(Schema.Array(SearchRange)),
})
export type SearchTopic = typeof SearchTopic.Type

export const SearchMessage = Schema.Struct({
  kind: Schema.Literal('message'),
  /** `<channel>:<ts>`. */
  id: Schema.String,
  /** The thread the message is in, or its channel's Main. */
  topicId: Schema.String,
  /** The topic's title, as a topic result shows it. */
  title: Schema.String,
  ts: Schema.String,
  place: SearchPlace,
  /** The sender's display name. */
  sender: Schema.String,
  /** The message text, on one line. */
  text: Schema.String,
  /** The store holds the message, so the topic opens at it without asking Slack. */
  stored: Schema.Boolean,
  /** The parts of `text` the text matched (`search.query`); `text` then starts a few words before the first. */
  ranges: Schema.optionalKey(Schema.Array(SearchRange)),
})
export type SearchMessage = typeof SearchMessage.Type

export const SearchChannel = Schema.Struct({
  kind: Schema.Literal('channel'),
  id: Schema.String,
  place: SearchPlace,
  /** The channel's Main topic, when the store has a message in it. */
  mainId: Schema.optionalKey(Schema.String),
})
export type SearchChannel = typeof SearchChannel.Type

export const SearchPerson = Schema.Struct({
  kind: Schema.Literal('person'),
  id: Schema.String,
  person: Person,
  /** The Main of your DM with them, when there is one. Without it the result opens Home addressed to them. */
  mainId: Schema.optionalKey(Schema.String),
})
export type SearchPerson = typeof SearchPerson.Type

export const SearchResult = Schema.Union([SearchTopic, SearchMessage, SearchChannel, SearchPerson])
export type SearchResult = typeof SearchResult.Type

/** Most results `search.query` returns. */
export const SEARCH_LIMIT_MAX = 50
/** Channels, then people, at most this many each, before topics and messages. */
export const SEARCH_PLACES_MAX = 3

/**
 * Local search only. Empty text returns recent topics. The engine caps limit
 * at `SEARCH_LIMIT_MAX`. `places: false` leaves out channels and people, for
 * ⌘K, which lists conversations from `newChat.ranked`.
 */
export const searchQuery = liveValueRoute('search.query', {
  payload: { query: Schema.String, limit: Schema.optionalKey(Schema.Int), places: Schema.optionalKey(Schema.Boolean) },
  value: Schema.Array(SearchResult),
})

/** Matches `search.slack` returns at most. */
export const SLACK_SEARCH_MAX = 20

/** One-shot Slack search for existing clients. ⌘K never calls it. */
export const searchSlack = Rpc.make('search.slack', {
  payload: { query: Schema.String },
  success: Schema.Array(SearchMessage),
  error: NotSignedIn,
})

const commandFields = {
  label: Schema.String,
  sub: Schema.String,
  /** 0..1, the badge's percentage. */
  confidence: Schema.Number,
  /** "↵ Send", "↵ Resolve" or "↵". */
  hint: Schema.String,
}

export const PaletteCommand = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('send-dm'), userId: Schema.String, text: Schema.String, place: Schema.String, ...commandFields }),
  Schema.Struct({ kind: Schema.Literal('open-dm'), userId: Schema.String, person: Person, mainId: Schema.optionalKey(Schema.String), ...commandFields }),
  Schema.Struct({ kind: Schema.Literal('post'), channelId: Schema.String, text: Schema.String, place: Schema.String, ...commandFields }),
  Schema.Struct({ kind: Schema.Literal('ask'), prompt: Schema.String, ...commandFields }),
  Schema.Struct({ kind: Schema.Literal('resolve'), topicId: Schema.String, title: Schema.String, ...commandFields }),
])
export type PaletteCommand = typeof PaletteCommand.Type

export const searchCommand = Rpc.make('search.command', {
  payload: { text: Schema.String },
  success: Schema.NullOr(PaletteCommand),
  error: NotSignedIn,
})

/** A topic's art recipe (`@juno/topic-art`) when it is drawn and AI assist is on; absent draws the placeholder. */
const art = Schema.optionalKey(Schema.String)
export const SearchHit = Schema.Struct({ ...SearchMessage.fields, ranges: Schema.Array(SearchRange), art })
export type SearchHit = typeof SearchHit.Type
export const SearchTitleHit = Schema.Struct({ ...SearchTopic.fields, ranges: Schema.Array(SearchRange), art })
export type SearchTitleHit = typeof SearchTitleHit.Type
export const SearchGroup = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['thread', 'main', 'topic']),
  topicId: Schema.String,
  title: Schema.String,
  titleRanges: Schema.Array(SearchRange),
  place: SearchPlace,
  art,
  at: Schema.String,
  messages: Schema.Array(SearchHit),
  older: Schema.Boolean,
  matchCount: Schema.Int,
})
export type SearchGroup = typeof SearchGroup.Type
export const SearchFacetPerson = Schema.Struct({ id: Schema.String, count: Schema.Int, person: Schema.optionalKey(Person) })
export type SearchFacetPerson = typeof SearchFacetPerson.Type
export const SearchFacetPlace = Schema.Struct({ id: Schema.String, count: Schema.Int, place: Schema.optionalKey(SearchPlace) })
export type SearchFacetPlace = typeof SearchFacetPlace.Type
export const SearchSnapshot = Schema.Struct({
  sessionId: Schema.String,
  generation: Schema.Int,
  query: SearchQuery,
  needsSlack: Schema.Boolean,
  state: Schema.Literals(['searching', 'done', 'slackUnavailable', 'offline', 'onlyHidden']),
  groups: Schema.Array(SearchGroup),
  frontier: Schema.Struct({ through: Schema.NullOr(Schema.String), complete: Schema.Boolean, olderGroupIndex: Schema.Int }),
  /** Slack's top people and conversations for the query with their match counts, named from the store when it knows them. */
  facets: Schema.Struct({ from: Schema.Array(SearchFacetPerson), in: Schema.Array(SearchFacetPlace) }),
  counts: Schema.Struct({ local: Schema.Int, slackLoaded: Schema.Int, hidden: Schema.Int, slackTotal: Schema.NullOr(Schema.Int) }),
  pagination: Schema.Struct({ page: Schema.Int, pageCount: Schema.Int, perPage: Schema.Int, first: Schema.Int, last: Schema.Int, hasMore: Schema.Boolean }),
  window: Schema.Struct({ offset: Schema.Int, totalGroups: Schema.Int, totalRows: Schema.Int, hasMoreLocal: Schema.Boolean }),
})
export type SearchSnapshot = typeof SearchSnapshot.Type
/** Metadata plus only changed groups. The order also removes groups outside the window. */
export const SearchUpdate = Schema.Struct({ ...SearchSnapshot.fields, groupOrder: Schema.Array(Schema.String) })
export type SearchUpdate = typeof SearchUpdate.Type
/** Subscribe once per query generation. Unsubscribing releases the session. */
export const searchSession = liveValueRoute('search.session', {
  payload: { sessionId: Schema.String, generation: Schema.Int, query: SearchQuery, immediate: Schema.optionalKey(Schema.Boolean) },
  value: SearchUpdate,
})
/** One sequential page, or retry after failure. Offset selects a 100-match/topic window from the loaded results. */
export const searchMore = Rpc.make('search.more', {
  payload: { sessionId: Schema.String, generation: Schema.Int, offset: Schema.optionalKey(Schema.Int) },
  success: Schema.Boolean,
})
export const SearchNavigation = Schema.Struct({ count: Schema.Int, index: Schema.Int, previous: Schema.NullOr(Schema.String), next: Schema.NullOr(Schema.String), marked: Schema.Array(Schema.String) })
export type SearchNavigation = typeof SearchNavigation.Type
export const searchMatches = liveValueRoute('search.matches', {
  payload: { sessionId: Schema.String, generation: Schema.Int, topicId: Schema.String, ts: Schema.optionalKey(Schema.String), first: Schema.optionalKey(Schema.String), last: Schema.optionalKey(Schema.String) },
  value: SearchNavigation,
})
export const searchCalendar = Rpc.make('search.calendar', { success: Schema.String, error: NotSignedIn })
export const SearchRoutes = RpcGroup.make(searchQuery, searchSlack, searchCommand, searchSession, searchMore, searchMatches, searchCalendar)
