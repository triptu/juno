/**
 * Huddles (SPEC 20, docs/plans/huddles.md, specs/huddle.qnt).
 *
 * The engine owns the call: Slack's requests, the leave that must be sent,
 * who is in each running huddle. The renderer owns the media session and
 * reports its state with `huddle.report`. There is one call at a time.
 *
 * - `huddle.call` is the current call, or how the last one ended.
 * - `huddle.running` is every running huddle Juno knows of, by channel id,
 *   for the sidebar's glyph and the header's control.
 * - `huddle.start` starts or joins the huddle in a channel, leaving the
 *   current one first. It answers once Slack has answered and the leave
 *   for the new attendee is stored: the answer carries the Chime meeting
 *   and attendee, once. They are secrets; never log or store them.
 * - `huddle.leave` leaves. It never waits for Slack.
 * - `huddle.report` is a renderer page's whole media state.
 *
 * A page generation names one load of a renderer page. The page's media
 * service makes one when it starts and registers it with main
 * (`huddle.register`), which tells the engine which generations are live
 * (`huddlePages`); a page that reloads, navigates, crashes or closes is
 * gone, and with it its media.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn, Offline, RateLimited, Rejected } from '../errors'
import { liveValueRoute } from '../live'

/**
 * `joining` from Start or Join until the media session has started,
 * `joined` while it runs, `leaving` while a leave is being sent or the
 * media session has not yet said it stopped.
 */
export const HuddlePhase = Schema.Literals(['idle', 'joining', 'joined', 'leaving'])
export type HuddlePhase = typeof HuddlePhase.Type

/** Why the media session stopped, as the renderer reports it. `left`: the engine asked it to. */
export const HuddleMediaEnd = Schema.Literals(['left', 'anotherDevice', 'connectionLost', 'failed', 'ended'])
export type HuddleMediaEnd = typeof HuddleMediaEnd.Type

/** How the last call ended. `joinFailed` carries Slack's error code. */
export const HuddleEnd = Schema.Struct({
  channelId: Schema.String,
  reason: Schema.Union([HuddleMediaEnd, Schema.Literal('joinFailed')]),
  code: Schema.optionalKey(Schema.String),
})
export type HuddleEnd = typeof HuddleEnd.Type

export const HuddleCall = Schema.Struct({
  phase: HuddlePhase,
  /** The call's channel; while switching, the channel being joined. Null when idle. */
  channelId: Schema.NullOr(Schema.String),
  callId: Schema.NullOr(Schema.String),
  /**
   * The one attendee whose media session may run. The renderer stops any
   * session for another attendee and reports `ended` for it.
   */
  attendeeId: Schema.NullOr(Schema.String),
  /** User ids in the call's huddle, in the order they joined, the user included. */
  participants: Schema.Array(Schema.String),
  /** When the huddle started (not when the user joined), in epoch milliseconds. */
  startedAt: Schema.NullOr(Schema.Number),
  /** The media session's connection while the page holds this attendee's session, else null. */
  connection: Schema.NullOr(Schema.Literals(['connecting', 'connected', 'reconnecting'])),
  /** The mute state the page reports for this attendee's session. */
  muted: Schema.Boolean,
  /** How the last call ended. Cleared by the next Start or Join. */
  ended: Schema.NullOr(HuddleEnd),
})
export type HuddleCall = typeof HuddleCall.Type

export const RunningHuddle = Schema.Struct({
  callId: Schema.String,
  /** User ids in the huddle. */
  participants: Schema.Array(Schema.String),
  /** Epoch milliseconds, when Slack says. */
  startedAt: Schema.NullOr(Schema.Number),
  /** The huddle's thread, once Slack has made it. */
  threadTs: Schema.NullOr(Schema.String),
})
export type RunningHuddle = typeof RunningHuddle.Type

/** Running huddles by channel id. A channel with none is absent. */
export const RunningHuddles = Schema.Record(Schema.String, RunningHuddle)
export type RunningHuddles = typeof RunningHuddles.Type

export const huddleCall = liveValueRoute('huddle.call', { value: HuddleCall })

/** One value for every channel, so a sidebar row reads its own entry from one subscription. */
export const huddleRunning = liveValueRoute('huddle.running', { value: RunningHuddles })

/** Chime's own `Meeting` and `Attendee`, for `new MeetingSessionConfiguration(meeting, attendee)`. Secrets. */
export const HuddleCredentials = Schema.Struct({
  meeting: Schema.Record(Schema.String, Schema.Unknown),
  attendee: Schema.Record(Schema.String, Schema.Unknown),
})
export type HuddleCredentials = typeof HuddleCredentials.Type

/**
 * `joined`: start the media session with `credentials`, unless
 * `huddle.call` names another attendee by then; the page reports that it
 * `received` them either way. `cancelled`: a later Start, Join or Leave
 * replaced this one before Slack answered, or the page is gone.
 */
export const HuddleStartResult = Schema.Union([
  Schema.TaggedStruct('joined', { channelId: Schema.String, callId: Schema.String, attendeeId: Schema.String, credentials: HuddleCredentials }),
  Schema.TaggedStruct('cancelled', {}),
])
export type HuddleStartResult = typeof HuddleStartResult.Type

export const HuddleError = Schema.Union([NotSignedIn, Offline, RateLimited, Rejected])
export type HuddleError = typeof HuddleError.Type

/**
 * `region` is Chime's nearest media region, which only the renderer may
 * look up; null when the lookup failed. `generation` is the asking page's:
 * the credentials go to it once main has reported it live, and only its
 * reports count for them. A generation main has not listed yet waits.
 */
export const huddleStart = Rpc.make('huddle.start', {
  payload: { channelId: Schema.String, region: Schema.NullOr(Schema.String), generation: Schema.String },
  success: HuddleStartResult,
  error: HuddleError,
})

export const huddleLeave = Rpc.make('huddle.leave', { success: Schema.Void })

/**
 * A page's whole media state, not a change. The page sends it on every
 * change and every time its connection to the engine opens (after an
 * engine restart too); the latest per generation wins, so a report may be
 * sent twice or arrive late.
 */
export const HuddlePageReport = Schema.Struct({
  generation: Schema.String,
  /** The attendee whose media session the page has (connecting, connected or reconnecting), or null for none. */
  holds: Schema.NullOr(Schema.String),
  /** The attendee of the last credentials the page received, or null for none: places the report after that hand-off. */
  received: Schema.NullOr(Schema.String),
  connection: Schema.Literals(['connecting', 'connected', 'reconnecting']),
  muted: Schema.Boolean,
  /** The last session the page ended, and why. `left`: the engine's call no longer named it. */
  ended: Schema.NullOr(Schema.Struct({ attendeeId: Schema.String, reason: HuddleMediaEnd })),
})
export type HuddlePageReport = typeof HuddlePageReport.Type

export const huddleReport = Rpc.make('huddle.report', { payload: { report: HuddlePageReport }, success: Schema.Void })

export const HuddleRoutes = RpcGroup.make(huddleCall, huddleRunning, huddleStart, huddleLeave, huddleReport)
