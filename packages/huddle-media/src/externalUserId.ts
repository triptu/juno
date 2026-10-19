/** The content share attendee of `A` is `A#content` (Chime's `ContentShareConstants.Modality`). */
export const CONTENT_SUFFIX = '#content'

const SHAPE = /^T[A-Z0-9]+-R[A-Z0-9]+-([UW][A-Z0-9]+)$/

/**
 * The Slack user id in a Chime `ExternalUserId`. Slack's shape is team id, room
 * id and user id joined by `-` (`T…-R…-U…`, research section 6). Undefined for
 * any other shape. A content share's id may carry `#content`, which is ignored.
 */
export function slackUserIdOf(externalUserId: string): string | undefined {
  const base = externalUserId.endsWith(CONTENT_SUFFIX) ? externalUserId.slice(0, -CONTENT_SUFFIX.length) : externalUserId
  return SHAPE.exec(base)?.[1]
}
