/** Decode getView rows independently, retaining list identity and the original page cursor. */
import { ThreadView, Ts } from '@juno/slack-schema'
import { decodeIssueDetails, SlackDecodeError } from '@juno/slack'
import { Effect, Option, Schema } from 'effect'

const Position = Schema.Struct({
  root_msg: Schema.Struct({
    channel: Schema.optionalKey(Schema.Unknown),
    ts: Schema.optionalKey(Schema.Unknown),
    latest_reply: Schema.optionalKey(Schema.Unknown),
  }),
})
const string = Schema.decodeUnknownOption(Schema.String)
const ts = Schema.decodeUnknownOption(Ts)

export const decodeThreadViewPage = (rows: ReadonlyArray<unknown>) => Effect.gen(function* () {
  const views: ThreadView[] = []
  const listed: string[] = []
  const errors: SlackDecodeError[] = []
  let identitiesComplete = true
  let lastActivity: Ts | undefined
  for (const [index, raw] of rows.entries()) {
    const position = Schema.decodeUnknownOption(Position)(raw)
    const root = Option.getOrUndefined(position)?.root_msg
    const channel = Option.getOrUndefined(string(root?.channel))
    const rootTs = Option.getOrUndefined(ts(root?.ts))
    if (channel !== undefined && rootTs !== undefined) listed.push(`${channel}:${rootTs}`)
    else identitiesComplete = false
    // Never page from the last surviving row or use a root timestamp as an activity cursor.
    lastActivity = Option.getOrUndefined(ts(root?.latest_reply))
    const decoded = Schema.decodeUnknownResult(ThreadView)(raw)
    if (decoded._tag === 'Success') views.push(decoded.success)
    else errors.push(new SlackDecodeError({
      method: 'subscriptions.thread.getView',
      message: 'thread does not match schema',
      ...decodeIssueDetails(decoded.failure.issue, ['threads', index]),
    }))
  }
  for (const cause of errors) yield* Effect.logWarning('sync: getView thread skipped', { count: errors.length, cause })
  return { views, listed, identitiesComplete, lastActivity }
})
