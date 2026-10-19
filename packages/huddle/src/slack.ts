/**
 * The huddle's Slack requests, in the official client's shape (research
 * section 2 and 6, `scripts/huddle-live.ts`), and how their errors read in
 * the contract.
 */
import { Effect } from 'effect'
import { NotSignedIn, Offline, RateLimited, Rejected, type HuddleCredentials, type HuddleError } from '@juno/contract'
import { SlackApi, SlackEdge, type SlackApiError } from '@juno/slack'
import { EdgeHuddlesInfoOk, type HuddleInfo, type MethodOk } from '@juno/slack-schema'
import type { HuddleSession } from './Huddle'
import type { Identity, Intent } from './lifecycle'

/** How many channel ids one `huddles/info` call takes. The official client's chunk size was not recorded. */
export const INFO_CHUNK = 50

/** Errors Slack gives for a leave that has nothing to do, or that this workspace does not use (`huddles_arch_v2`). */
const BENIGN_LEAVE_ERRORS = new Set(['feature_not_enabled', 'channel_not_found', 'room_not_found', 'invalid_channel_id', 'attendee_not_found'])

/** `rooms.join`, once: a retry could make a second attendee no one knows to leave. */
export const joinRequest = (session: HuddleSession, intent: Intent) =>
  SlackApi.use((api) =>
    api.call(
      'rooms.join',
      { channel_id: intent.channelId, ...(intent.region === null ? {} : { regions: [intent.region] }), multidevice: false },
      { reason: 'calls-api/joinRoom', singleAttempt: true },
    ),
  ).pipe(Effect.provide(session.slack))

/** `rooms.leave` as the official client's user leave sends it. Its answer is only logged. */
export const leaveRequest = (session: HuddleSession, identity: Identity) =>
  SlackApi.use((api) =>
    api.call('rooms.leave', { channel_id: identity.channelId, call_id: identity.callId, attendee_id: identity.attendeeId, reason: 'user_initiated' }, { reason: 'calls-api/leaveRoom' }),
  ).pipe(
    Effect.provide(session.slack),
    Effect.asVoid,
    Effect.catch((error) =>
      error._tag === 'SlackRejected' && BENIGN_LEAVE_ERRORS.has(error.error)
        ? Effect.logDebug('huddle: rooms.leave had nothing to do', { error: error.error })
        : Effect.logWarning('huddle: rooms.leave failed', { error: error._tag === 'SlackRejected' ? error.error : error._tag })),
  )

/** The running huddles of `ids`, in chunks, two at a time. */
export const infoRequest = (session: HuddleSession, ids: Iterable<string>) => {
  const chunks: Array<Array<string>> = []
  for (const id of ids) {
    const last = chunks[chunks.length - 1]
    if (last === undefined || last.length >= INFO_CHUNK) chunks.push([id])
    else last.push(id)
  }
  return Effect.forEach(chunks, (chunk) => SlackEdge.use((edge) => edge.call('huddles/info', { channel_ids: chunk }, EdgeHuddlesInfoOk)), { concurrency: 2 }).pipe(
    Effect.map((answers): ReadonlyArray<HuddleInfo> => answers.flatMap((ok) => ok.huddles)),
    Effect.provide(session.slack),
  )
}

/**
 * Slack's error as the contract says it. A join answer Juno cannot read
 * is a bug, but the Start still needs an answer: it fails as `Rejected`
 * and is logged.
 */
export const toHuddleError = (error: SlackApiError): Effect.Effect<HuddleError> => {
  switch (error._tag) {
    case 'SlackTransportError':
      return Effect.succeed(new Offline())
    case 'SlackRateLimited':
      return Effect.succeed(new RateLimited({ retryAfterMillis: error.retryAfterMillis }))
    case 'SlackRejected':
      return Effect.succeed(new Rejected({ code: error.error }))
    case 'SlackAuthRequired':
      return Effect.succeed(new NotSignedIn())
    case 'SlackDecodeError':
      return Effect.logError('huddle: rooms.join answered in a shape Juno cannot read', { message: error.message }).pipe(Effect.as(new Rejected({ code: 'unreadable_answer' })))
  }
}

/** The code `huddle.call`'s `ended` carries for a failed join. */
export const codeOf = (error: HuddleError): string => {
  switch (error._tag) {
    case 'Rejected':
      return error.code
    case 'RateLimited':
      return 'rate_limited'
    case 'Offline':
      return 'offline'
    case 'NotSignedIn':
      return 'not_signed_in'
  }
}

/** The identity and credentials of a join answer, or none (the legacy calls-server answer has no `free_willy`). */
export const joinedFrom = (channelId: string, answer: MethodOk<'rooms.join'>): { readonly identity: Identity; readonly credentials: HuddleCredentials } | undefined => {
  const free = answer.call.free_willy
  const attendeeId = free?.attendee['AttendeeId']
  if (free === undefined || typeof attendeeId !== 'string') return undefined
  return { identity: { channelId, callId: answer.call.call_id, attendeeId }, credentials: { meeting: free.meeting, attendee: free.attendee } }
}
