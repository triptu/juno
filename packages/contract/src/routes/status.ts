/**
 * Slack profile status (SPEC 14, "Your status"): an emoji and a short text,
 * with an optional time it clears at.
 *
 * - `status.of` is one person's status as the store has it, from every user
 *   object Slack sends (the boot's `self`, the edge `users/info` and
 *   `user_change`). It is null when they have none, and becomes null at
 *   `expiresAt`: the engine sends the change at that moment, so nothing polls.
 * - `status.set` sets or clears the user's own with `users.profile.set`.
 *   `clearAfter` is a choice the engine turns into a time, or `{ at }` to
 *   keep the time an existing status clears at.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { liveValueRoute } from '../live'

export { STATUS_CLEAR_AFTER, STATUS_PRESETS, STATUS_TEXT_MAX, statusUntil, type StatusClearAfter } from '@juno/domain'

/** The status's emoji: a standard emoji's text, or a custom emoji's image; neither when the workspace no longer has it. */
export const StatusEmoji = Schema.Struct({
  name: Schema.String,
  unicode: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
})
export type StatusEmoji = typeof StatusEmoji.Type

export const ProfileStatus = Schema.Struct({
  text: Schema.String,
  emoji: Schema.optionalKey(StatusEmoji),
  /** Epoch milliseconds it clears at; absent when it does not. */
  expiresAt: Schema.optionalKey(Schema.Number),
})
export type ProfileStatus = typeof ProfileStatus.Type

export const statusOf = liveValueRoute('status.of', { payload: { userId: Schema.String }, value: Schema.NullOr(ProfileStatus) })

export const StatusClearAfterChoice = Schema.Union([Schema.Literals(['never', '30m', '1h', '4h', 'today', 'week']), Schema.Struct({ at: Schema.Number })])
export type StatusClearAfterChoice = typeof StatusClearAfterChoice.Type

export const StatusError = Schema.Union([NotSignedIn, Rejected, Offline, RateLimited])
export type StatusError = typeof StatusError.Type

/** Sets the user's status; empty text and emoji clear it. `emoji` is a name without colons. */
export const statusSet = Rpc.make('status.set', {
  payload: { text: Schema.String, emoji: Schema.String, clearAfter: StatusClearAfterChoice },
  success: Schema.Void,
  error: StatusError,
})

export const StatusRoutes = RpcGroup.make(statusOf, statusSet)
