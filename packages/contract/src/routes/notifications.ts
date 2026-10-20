/**
 * Notification routes (spec section 14, inventory 2.1, 13 and 15).
 *
 * - `notifications.settings` is the owner's settings as stored, with the AI
 *   assist switch. The menus read the current Notify me level from it.
 * - `notifications.page` is what the Notifications page shows beyond the
 *   settings: the Every message and Never lists with their names, and today.
 * - `notifications.status` is the avatar menu's line and hint: presence
 *   with until when, and "Paused until 9am" outside notification hours.
 * - `notifications.why` answers the message menu's why item.
 * - The setters write the settings. `notifications.setLevel` returns an
 *   undo (ADR 0010); on a thread it also follows or unfollows it (SPEC 5).
 * - `notifications.setHuddleRing` is Ring for huddles (SPEC 20).
 * - `notifications.setPresence` is Set yourself away or active. It holds
 *   until the next switch in the active hours.
 * - `notifications.setSlackSchedule` and `notifications.restoreSlackSchedule`
 *   are the switch and Restore for Slack's own schedule; the page value
 *   carries their state.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { ConversationKind } from '@juno/domain'
import { NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { liveValueRoute } from '../live'
import { CommandResult, NotifyChoiceSchema, NotifyTargetSchema, SubscribeError } from './topics'

const Minute = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 }))
const Weekday = Schema.Literals([0, 1, 2, 3, 4, 5, 6])

/** Days of the week (0 is Sunday) and a from and to time in minutes since midnight. A to before from crosses midnight. */
export const Hours = Schema.Struct({ days: Schema.Array(Weekday), from: Minute, to: Minute })
export type Hours = typeof Hours.Type

export const NotifyLevel = Schema.Literals(['every', 'never'])

export const NotificationSettingsView = Schema.Struct({
  notificationHours: Hours,
  presenceHours: Hours,
  matters: Schema.String,
  channels: Schema.Record(Schema.String, NotifyLevel),
  people: Schema.Record(Schema.String, NotifyLevel),
  threads: Schema.Record(Schema.String, NotifyLevel),
  /** Off: DMs and mentions notify, and What matters to you is not read. */
  aiAssist: Schema.Boolean,
  /** Ring for huddles. Off: an incoming huddle shows its card and notification without the sound. */
  huddleRing: Schema.Boolean,
})
export type NotificationSettingsView = typeof NotificationSettingsView.Type

export const notificationsSettings = liveValueRoute('notifications.settings', { value: NotificationSettingsView })

/** A channel, DM or person on the page's Every message or Never list. */
export const NotifyTag = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('channel'), id: Schema.String, name: Schema.String, channelKind: ConversationKind }),
  Schema.Struct({ kind: Schema.Literal('person'), id: Schema.String, name: Schema.String, avatarUrl: Schema.optionalKey(Schema.String) }),
])
export type NotifyTag = typeof NotifyTag.Type

/** One message that notified today, for Show why. */
export const TodayRow = Schema.Struct({
  id: Schema.Int,
  /** Epoch milliseconds. */
  at: Schema.Number,
  /** "#eng", "Maya Chen". */
  place: Schema.String,
  sender: Schema.String,
  text: Schema.String,
  reason: Schema.String,
})
export type TodayRow = typeof TodayRow.Type

/** Slack's own notification schedule, which Juno writes from the notification hours (SPEC 14). */
export const SlackScheduleView = Schema.Struct({
  /** Juno writes the notification hours into Slack's schedule. On by default. */
  enabled: Schema.Boolean,
  /** Juno kept the schedule Slack had before Juno's first write, so Restore can put it back. */
  canRestore: Schema.Boolean,
  /** The schedule was changed in Slack after Juno wrote it. Juno leaves it until the hours change in Juno. */
  changedInSlack: Schema.Boolean,
  /** On, but the hours are still Juno's defaults on this install: nothing is written until they are set or the switch is turned on again. */
  waitingForHours: Schema.Boolean,
})
export type SlackScheduleView = typeof SlackScheduleView.Type

export const NotificationsPage = Schema.Struct({
  every: Schema.Array(NotifyTag),
  never: Schema.Array(NotifyTag),
  /** Messages that notified today. */
  interrupted: Schema.Int,
  /** Messages Juno held today. */
  held: Schema.Int,
  /** The messages that notified today, newest first, at most 50. */
  today: Schema.Array(TodayRow),
  slackSchedule: SlackScheduleView,
})
export type NotificationsPage = typeof NotificationsPage.Type

export const notificationsPage = liveValueRoute('notifications.page', { value: NotificationsPage })

export const PresenceValue = Schema.Literals(['active', 'away'])
export type PresenceValue = typeof PresenceValue.Type

export const NotificationStatus = Schema.Struct({
  /** What Slack shows now, once known. */
  presence: Schema.NullOr(PresenceValue),
  /** "Active", "Away until 9am", "Active until 8pm". */
  presenceLabel: Schema.String,
  /** "Paused until 9am" outside notification hours. */
  paused: Schema.optionalKey(Schema.String),
})
export type NotificationStatus = typeof NotificationStatus.Type

export const notificationsStatus = liveValueRoute('notifications.status', { value: NotificationStatus })

/**
 * Why a message did or did not notify. `change` is the thread, channel or
 * person whose Notify me level decided it; `hours` opens the page; `juno`
 * offers Tell Juno.
 */
export const Why = Schema.Struct({
  notified: Schema.Boolean,
  /** "Notified you at 13:42", "Didn't notify you". */
  title: Schema.String,
  reason: Schema.String,
  action: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('change'), target: NotifyTargetSchema, name: Schema.String }),
    Schema.Struct({ kind: Schema.Literal('hours') }),
    Schema.Struct({ kind: Schema.Literal('juno') }),
    Schema.Struct({ kind: Schema.Literal('none') }),
  ]),
})
export type Why = typeof Why.Type

export const notificationsWhy = Rpc.make('notifications.why', {
  payload: { topicId: Schema.String, ts: Schema.String },
  success: Why,
  error: NotSignedIn,
})

export const notificationsSetHours = Rpc.make('notifications.setHours', {
  payload: { which: Schema.Literals(['notifications', 'presence']), hours: Hours },
  success: Schema.Void,
  error: NotSignedIn,
})

export const notificationsSetMatters = Rpc.make('notifications.setMatters', {
  payload: { text: Schema.String.check(Schema.isMaxLength(2000)) },
  success: Schema.Void,
  error: NotSignedIn,
})

/** Ring for huddles on or off. */
export const notificationsSetHuddleRing = Rpc.make('notifications.setHuddleRing', {
  payload: { enabled: Schema.Boolean },
  success: Schema.Void,
  error: NotSignedIn,
})

/** Sets a Notify me choice. On a thread, Every message and When it matters follow it and Never unfollows it. */
export const notificationsSetLevel = Rpc.make('notifications.setLevel', {
  payload: { target: NotifyTargetSchema, choice: NotifyChoiceSchema },
  success: CommandResult,
  error: SubscribeError,
})

export const notificationsSetPresence = Rpc.make('notifications.setPresence', {
  payload: { presence: PresenceValue },
  success: Schema.Void,
  error: NotSignedIn,
})

/** Turns writing Slack's schedule on or off. On applies the notification hours once, even unchanged. */
export const notificationsSetSlackSchedule = Rpc.make('notifications.setSlackSchedule', {
  payload: { enabled: Schema.Boolean },
  success: Schema.Void,
  error: NotSignedIn,
})

/** Writes back the schedule Slack had before Juno's first write, and turns writing it off. */
export const notificationsRestoreSlackSchedule = Rpc.make('notifications.restoreSlackSchedule', {
  payload: {},
  success: Schema.Void,
  error: Schema.Union([NotSignedIn, Rejected, RateLimited, Offline]),
})

export const NotificationsRoutes = RpcGroup.make(
  notificationsSettings,
  notificationsPage,
  notificationsStatus,
  notificationsWhy,
  notificationsSetHours,
  notificationsSetMatters,
  notificationsSetHuddleRing,
  notificationsSetLevel,
  notificationsSetPresence,
  notificationsSetSlackSchedule,
  notificationsRestoreSlackSchedule,
)
