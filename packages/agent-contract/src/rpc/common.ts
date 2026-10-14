import { Schema } from 'effect'
import { OpId } from '../chat/ids'

export const PageLimit = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(200))
/** Exclusive id of the last row in the preceding page; absent opens the newest rows. */
export const Cursor = Schema.String.pipe(Schema.brand('AgentPageCursor'))
export const PageWindow = Schema.Struct({ cursor: Schema.optionalKey(Cursor), limit: PageLimit })
export const Accepted = Schema.Struct({ opId: OpId })
/** Returned only after the FULL inbox commit. A retry uses the same op id. */
export const operation = { opId: OpId }
export class AgentCommandError extends Schema.TaggedError<AgentCommandError>()('AgentCommandError', {
  reason: Schema.Literals(['notDelivered', 'tooLong', 'stale', 'expired', 'readOnly', 'invalid', 'unavailable']),
  message: Schema.String,
}) {}
