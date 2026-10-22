/**
 * The "who reacted" dialog's data (inventory 6.4): `reactions.who`, a live
 * value that reads the store and, unlike the topic view's live queries, may
 * call Slack once when the store lists fewer people than a reaction's count.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'
import { Person } from '../refs'

/** One reaction in the "who reacted" dialog. */
export const WhoReactedReaction = Schema.Struct({
  /** Slack's name, as on `ReactionView`. */
  name: Schema.String,
  count: Schema.Int,
  me: Schema.Boolean,
  unicode: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  /**
   * Everyone Juno knows reacted, as user ids: you first when `me`, then the
   * others in Slack's order. Fewer than `count` while `loading`, or when
   * Slack does not list everyone.
   */
  users: Schema.Array(Schema.String),
})
export type WhoReactedReaction = typeof WhoReactedReaction.Type

export const WhoReacted = Schema.Struct({
  /** The message's reactions in Slack's order, with the user's own changes not yet sent applied, as the chips show them. */
  reactions: Schema.Array(WhoReactedReaction),
  /** The people `users` names that the store knows, once each. The others are asked of Slack and arrive in a later value. */
  people: Schema.Array(Person),
  /** Juno is fetching the full list from Slack. */
  loading: Schema.Boolean,
})
export type WhoReacted = typeof WhoReacted.Type

/**
 * Everyone who reacted to one message, for the "who reacted" dialog. `null`
 * for a message the store does not have, or one deleted. The first value is
 * what the store holds. When a reaction lists fewer people than its count,
 * the subscription fetches the full list once (`reactions.get` with `full`,
 * on the interactive lane) with `loading` set; the value updates when it is
 * stored. A failed fetch keeps what is stored and clears `loading`.
 */
export const reactionsWho = liveValueRoute('reactions.who', {
  payload: { channel: Schema.String, ts: Schema.String },
  value: Schema.NullOr(WhoReacted),
})

export const WhoReactedRoutes = RpcGroup.make(reactionsWho)
