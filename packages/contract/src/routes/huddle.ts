/**
 * Huddles (SPEC 20, docs/plans/huddles.md, specs/huddle.qnt).
 *
 * The engine owns the call: Slack's requests, the leave that must be sent,
 * who is in each running huddle. The renderer owns the media session and
 * reports what it does with `huddle.media`. There is one call at a time.
 *
 * - `huddle.call` is the current call, or how the last one ended.
 * - `huddle.running` is every running huddle Juno knows of, by channel id,
 *   for the sidebar's glyph and the header's control.
 * - `huddle.start` starts or joins the huddle in a channel, leaving the
 *   current one first. It answers once Slack has answered and the leave
 *   for the new attendee is stored: the answer carries the Chime meeting
 *   and attendee, once. They are secrets; never log or store them.
 * - `huddle.leave` leaves. It never waits for Slack.
 * - `huddle.media` is the renderer's report, tagged with its page
 *   generation and the attendee id.
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
  /** The last mute state the media session reported for this attendee. */
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
 * `huddle.call` names another attendee by then. `cancelled`: a later
 * Start, Join or Leave replaced this one before Slack answered.
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
 * the credentials go to it, and only its reports count for them.
 */
export const huddleStart = Rpc.make('huddle.start', {
  payload: { channelId: Schema.String, region: Schema.NullOr(Schema.String), generation: Schema.String },
  success: HuddleStartResult,
  error: HuddleError,
})

export const huddleLeave = Rpc.make('huddle.leave', { success: Schema.Void })

/**
 * What the media session of page `generation` did, for the attendee it ran
 * as. A report from a page other than the one holding the attendee's
 * credentials is ignored.
 */
export const HuddleMediaEvent = Schema.Union([
  Schema.TaggedStruct('started', { generation: Schema.String, attendeeId: Schema.String }),
  Schema.TaggedStruct('ended', { generation: Schema.String, attendeeId: Schema.String, reason: HuddleMediaEnd }),
  Schema.TaggedStruct('muted', { generation: Schema.String, attendeeId: Schema.String, muted: Schema.Boolean }),
])
export type HuddleMediaEvent = typeof HuddleMediaEvent.Type

export const huddleMedia = Rpc.make('huddle.media', { payload: { event: HuddleMediaEvent }, success: Schema.Void })

export const HuddleRoutes = RpcGroup.make(huddleCall, huddleRunning, huddleStart, huddleLeave, huddleMedia)
