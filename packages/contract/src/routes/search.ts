/**
 * ⌘K (spec section 10, inventory 9).
 *
 * - `search.query`, a live value that never calls Slack: topic titles,
 *   message text, channels and people from the local FTS indexes. Empty
 *   text returns recent topics.
 * - `search.slack`, a command: Slack's own message search, for what the
 *   local cache does not hold. It writes nothing to the store; the palette
 *   adds its matches under the local ones.
 * - `search.command`, a command: what the typed text means as a command
 *   (spec section 15, "Command routing"), from the grammar in
 *   `@juno/domain` and then the model. `null` when it is a search, or when
 *   AI assist is off.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'
import { ChannelRef, Person } from '../refs'

/** Where a result lives, without the DM partner's id. */
const { partnerId: _partnerId, ...placeFields } = ChannelRef.fields
export const SearchPlace = Schema.Struct(placeFields)
export type SearchPlace = typeof SearchPlace.Type

export const SearchTopic = Schema.Struct({
  kind: Schema.Literal('topic'),
  id: Schema.String,
  /** The topic's title; "#eng · Main" for a Main. */
  title: Schema.String,
  place: SearchPlace,
  /** Epoch milliseconds of the latest activity. */
  at: Schema.Number,
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
  /** The Main of your DM with them, when there is one. Without it the result opens a New chat to them. */
  mainId: Schema.optionalKey(Schema.String),
})
export type SearchPerson = typeof SearchPerson.Type

export const SearchResult = Schema.Union([SearchTopic, SearchMessage, SearchChannel, SearchPerson])
export type SearchResult = typeof SearchResult.Type

/** Most results `search.query` returns. */
export const SEARCH_LIMIT_MAX = 50
/** Channels, then people, at most this many each, before topics and messages. */
export const SEARCH_PLACES_MAX = 3

/** Local search only. Empty text returns recent topics. The engine caps limit at `SEARCH_LIMIT_MAX`. */
export const searchQuery = liveValueRoute('search.query', {
  payload: { query: Schema.String, limit: Schema.optionalKey(Schema.Int) },
  value: Schema.Array(SearchResult),
})

/** Matches `search.slack` returns at most. */
export const SLACK_SEARCH_MAX = 20

/** Slack's message search, newest Slack ranking first. Empty when Slack cannot be reached. */
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
  Schema.Struct({ kind: Schema.Literal('open-dm'), userId: Schema.String, mainId: Schema.optionalKey(Schema.String), ...commandFields }),
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

export const SearchRoutes = RpcGroup.make(searchQuery, searchSlack, searchCommand)
