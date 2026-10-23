/**
 * Notification routes (spec section 14, inventory 2.1, 13 and 15).
 *
 * - `notifications.settings` is the owner's settings as stored, with the AI
 *   assist switch. The menus read the current Notify me level from it.
 * - `notifications.page` is what the Notifications page shows beyond the
 *   settings: the Always and Never lists with their names, today's counts
 *   and the state of Slack's schedule.
 * - `notifications.decisions` is every decision today, newest first, for
 *   the Details dialog and the why popover.
 * - `notifications.status` is the avatar menu's line and hint: presence
 *   with until when, what Slack shows colleagues when it differs, and
 *   "Paused until 9am" outside notification hours. `seen` drives the
 *   avatar's dot.
 * - The setters write the settings. `notifications.setLevel` returns an
 *   undo (ADR 0010); on a thread it also follows or unfollows it (SPEC 5).
 * - `notifications.setAlwaysNotify` is one of the five Always notify switches.
 * - `notifications.saveInstruction` and `notifications.removeInstruction`
 *   edit Your instructions. `notifications.checkInstruction` asks once,
 *   when one is added, whether it is really a rule about one person or
 *   channel.
 * - `notifications.setHuddleRing` is Ring for huddles (SPEC 20).
 * - `notifications.setPresence` is Set yourself away or active. It holds
 *   until the next switch in the active hours.
 * - `notifications.useJunoHours` writes the notification hours to Slack's
 *   schedule again after it was changed in Slack.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { ConversationKind } from '@juno/domain'
import { NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'
import { CommandResult, NotifyChoiceSchema, NotifyTargetSchema, SubscribeError } from './topics'

const Minute = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 }))
const Weekday = Schema.Literals([0, 1, 2, 3, 4, 5, 6])

/** Days of the week (0 is Sunday) and a from and to time in minutes since midnight. A to before from crosses midnight. */
export const Hours = Schema.Struct({ days: Schema.Array(Weekday), from: Minute, to: Minute })
export type Hours = typeof Hours.Type

/** A stored level. Auto, the default, is no entry. */
export const NotifyLevel = Schema.Literals(['always', 'never'])

/** The five Always notify switches. Each notifies without Juno's reading. */
export const AlwaysNotify = Schema.Struct({
  /** Direct messages. Default off. */
  dms: Schema.Boolean,
  /** Group DMs, any size. Default off. */
  groupDms: Schema.Boolean,
  /** Mentions of the owner, their groups, @here and @channel. Default on. */
  mentions: Schema.Boolean,
  /** Every reply in a thread the owner started. Default off. On whenever `followedThreads` is on. */
  startedThreads: Schema.Boolean,
  /** Every reply in a thread the owner follows. Default off. */
  followedThreads: Schema.Boolean,
})
export type AlwaysNotify = typeof AlwaysNotify.Type
export const AlwaysNotifySwitch = Schema.Literals(['dms', 'groupDms', 'mentions', 'startedThreads', 'followedThreads'])
export type AlwaysNotifySwitch = typeof AlwaysNotifySwitch.Type

/** Notify me or Don't notify. The owner chooses one for each instruction; there is no default. */
export const InstructionDirection = Schema.Literals(['notify', 'stay'])
export type InstructionDirection = typeof InstructionDirection.Type

/** One of Your instructions, in the owner's words. Juno follows them when it reads messages on Auto. */
export const Instruction = Schema.Struct({ id: Schema.String, direction: InstructionDirection, text: Schema.String })
export type Instruction = typeof Instruction.Type

export const NotificationSettingsView = Schema.Struct({
  notificationHours: Hours,
  presenceHours: Hours,
  channels: Schema.Record(Schema.String, NotifyLevel),
  people: Schema.Record(Schema.String, NotifyLevel),
  threads: Schema.Record(Schema.String, NotifyLevel),
  alwaysNotify: AlwaysNotify,
  instructions: Schema.Array(Instruction),
  /** Off: DMs and mentions notify, the rest stays, and nothing is read. */
  aiAssist: Schema.Boolean,
  /** Ring for huddles. Off: an incoming huddle shows its card and notification without the sound. */
  huddleRing: Schema.Boolean,
})
export type NotificationSettingsView = typeof NotificationSettingsView.Type

export const notificationsSettings = liveValueRoute('notifications.settings', { value: NotificationSettingsView })

/** A channel, DM, person or thread on the page's Always or Never list. A thread is named by its topic title. */
export const NotifyTag = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('channel'), id: Schema.String, name: Schema.String, channelKind: ConversationKind }),
  Schema.Struct({ kind: Schema.Literal('person'), id: Schema.String, name: Schema.String, avatarUrl: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('thread'), id: Schema.String, name: Schema.String }),
])
export type NotifyTag = typeof NotifyTag.Type

/** What decided a message, first in the order that applied (SPEC 14). */
export const DecidedBy = Schema.Literals([
  'hours', 'always', 'never', 'ignored', 'directMention', 'alwaysNotify', 'aiOff', 'closer', 'addressedElsewhere', 'live', 'instruction', 'reading', 'timeout', 'burst',
])
export type DecidedBy = typeof DecidedBy.Type

/** A banner, or no banner and unread in Juno as usual. */
export const NotificationOutcome = Schema.Literals(['notify', 'stay'])
export type NotificationOutcome = typeof NotificationOutcome.Type

/** One decision today: a row of Today › Details, with all its Why actions need. */
export const TodayRow = Schema.Struct({
  id: Schema.Int,
  /** Epoch milliseconds. */
  at: Schema.Number,
  /** The conversation: "#eng", "Maya Chen". */
  place: Schema.String,
  sender: Schema.String,
  /** For Always for <name>. */
  senderId: Schema.String,
  /** The conversation, for Change on it. */
  channelId: Schema.String,
  topicId: Schema.String,
  /** The message's text. */
  text: Schema.String,
  outcome: NotificationOutcome,
  decidedBy: DecidedBy,
  /** One line built from facts and the chosen option: "#design is set to Always.", "Sam asks you something." */
  reason: Schema.String,
  /** The thread, channel or person whose level decided it, for Change. */
  target: Schema.optionalKey(NotifyTargetSchema),
  /** The instruction that decided it, for Edit instructions. */
  instructionId: Schema.optionalKey(Schema.String),
})
export type TodayRow = typeof TodayRow.Type

/** Details lists at most this many of today's decisions, the latest. */
export const TODAY_DECISIONS_LIMIT = 500

export const NotificationDecisions = Schema.Struct({
  /** Today's decisions, newest first, at most `TODAY_DECISIONS_LIMIT`. */
  decisions: Schema.Array(TodayRow),
})
export type NotificationDecisions = typeof NotificationDecisions.Type

export const notificationsDecisions = liveValueRoute('notifications.decisions', { value: NotificationDecisions })

/** Slack's own notification schedule, which Juno writes from the notification hours (SPEC 14). */
export const SlackScheduleView = Schema.Struct({
  /** The schedule was changed in Slack after Juno wrote it. Juno leaves it until the hours change in Juno or Use Juno's hours. */
  changedInSlack: Schema.Boolean,
  /** The hours are still Juno's defaults on this install: nothing is written until the owner sets them. */
  waitingForHours: Schema.Boolean,
})
export type SlackScheduleView = typeof SlackScheduleView.Type

export const NotificationsPage = Schema.Struct({
  always: Schema.Array(NotifyTag),
  never: Schema.Array(NotifyTag),
  /** Messages that notified today. */
  notified: Schema.Int,
  /** Messages that stayed in Juno today. */
  stayed: Schema.Int,
  slackSchedule: SlackScheduleView,
})
export type NotificationsPage = typeof NotificationsPage.Type

export const notificationsPage = liveValueRoute('notifications.page', { value: NotificationsPage })

export const PresenceValue = Schema.Literals(['active', 'away'])
export type PresenceValue = typeof PresenceValue.Type

export const NotificationStatus = Schema.Struct({
  /** The presence setting (Slack's `manual_presence`), once known: what Set yourself away or active and the active hours change. */
  presence: Schema.NullOr(PresenceValue),
  /** What Slack shows colleagues, from `presence_change` for the user; null until Slack answers and while the socket is down. */
  seen: Schema.NullOr(PresenceValue),
  /** "Active", "Away until 9am", "Active until 8pm", then "Slack shows you away" or "Connecting to Slack" when `seen` differs. */
  presenceLabel: Schema.String,
  /** "Paused until 9am" outside notification hours. */
  paused: Schema.optionalKey(Schema.String),
})
export type NotificationStatus = typeof NotificationStatus.Type

export const notificationsStatus = liveValueRoute('notifications.status', { value: NotificationStatus })

export const notificationsSetHours = Rpc.make('notifications.setHours', {
  payload: { which: Schema.Literals(['notifications', 'presence']), hours: Hours.mapFields(({ days, from, to }) => ({ days: Schema.optionalKey(days), from: Schema.optionalKey(from), to: Schema.optionalKey(to) })) },
  success: Schema.Void,
  error: NotSignedIn,
})

/** Sets one day without resending the other days from a possibly older page. */
export const notificationsSetDay = Rpc.make('notifications.setDay', {
  payload: { which: Schema.Literals(['notifications', 'presence']), day: Weekday, enabled: Schema.Boolean },
  success: Schema.Void,
  error: NotSignedIn,
})

/** Turns one Always notify switch on or off. */
export const notificationsSetAlwaysNotify = Rpc.make('notifications.setAlwaysNotify', {
  payload: { which: AlwaysNotifySwitch, enabled: Schema.Boolean },
  success: Schema.Void,
  error: NotSignedIn,
})

const InstructionText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500))

/** Adds an instruction (no id) or changes one. Answers with its id, which is new whenever the text or direction changed. */
export const notificationsSaveInstruction = Rpc.make('notifications.saveInstruction', {
  payload: { id: Schema.optionalKey(Schema.String), direction: InstructionDirection, text: InstructionText },
  success: Schema.Struct({ id: Schema.String }),
  error: NotSignedIn,
})

export const notificationsRemoveInstruction = Rpc.make('notifications.removeInstruction', {
  payload: { id: Schema.String },
  success: Schema.Void,
  error: NotSignedIn,
})

/** A rule found in an instruction: "Alex Chen → Always". The UI offers Make it a setting. */
export const InstructionRule = Schema.Struct({
  kind: Schema.Literals(['person', 'channel']),
  id: Schema.String,
  /** "Alex Chen", "#design". */
  name: Schema.String,
  level: NotifyLevel,
})
export type InstructionRule = typeof InstructionRule.Type

/** Whether an added instruction is really a rule about one person or channel. Null when it is not, or when Juno could not tell. */
export const notificationsCheckInstruction = Rpc.make('notifications.checkInstruction', {
  /** The direction the owner chose sets the level: Notify me is Always, Don't notify is Never. */
  payload: { text: InstructionText, direction: InstructionDirection },
  success: Schema.NullOr(InstructionRule),
  error: NotSignedIn,
})

/** Ring for huddles on or off. */
export const notificationsSetHuddleRing = Rpc.make('notifications.setHuddleRing', {
  payload: { enabled: Schema.Boolean },
  success: Schema.Void,
  error: NotSignedIn,
})

/** Sets a Notify me choice. On a thread, Always and Auto follow it and Never unfollows it. */
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

/** Writes the notification hours to Slack's schedule again, after it was changed in Slack. */
export const notificationsUseJunoHours = Rpc.make('notifications.useJunoHours', {
  payload: {},
  success: Schema.Void,
  error: NotSignedIn,
})

export const NotificationsRoutes = RpcGroup.make(
  notificationsSettings,
  notificationsPage,
  notificationsStatus,
  notificationsSetHours,
  notificationsSetDay,
  notificationsDecisions,
  notificationsSetAlwaysNotify,
  notificationsSaveInstruction,
  notificationsRemoveInstruction,
  notificationsCheckInstruction,
  notificationsSetHuddleRing,
  notificationsSetLevel,
  notificationsSetPresence,
  notificationsUseJunoHours,
)
