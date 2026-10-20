/** Sidebar unread eligibility shared by the sidebar counts and the dock badge. */
/** Followed threads, or unread mentions unless explicitly unfollowed. */
export const THREAD_RULE = ` AND (i.kind <> 'thread' OR s.subscribed = 1 OR (s.subscribed IS NULL AND i.mentions_me = 1 AND i.unread_count > 0))`

/** Unresolved topics, or topics with activity since they were resolved. */
export const OPEN_RULE = ` AND (o.resolved_at IS NULL OR (o.resolved_activity_ts IS NOT NULL AND i.last_activity_ts > o.resolved_activity_ts))`

export const UNREAD_FROM = `FROM topic_index i INDEXED BY topic_index_unread
      JOIN conversations c ON c.id = i.channel
      LEFT JOIN ignored_channels ig ON ig.channel = i.channel
      LEFT JOIN topic_overlay o ON o.topic_id = i.topic_id
      LEFT JOIN thread_subs s ON i.kind = 'thread' AND s.channel = i.channel AND s.thread_ts = i.root_ts
      WHERE i.unread_count > 0 AND i.last_activity_ts > '0' AND c.is_member = 1 AND c.is_archived = 0 AND ig.channel IS NULL
        AND (o.pinned_at IS NOT NULL OR (1${OPEN_RULE}${THREAD_RULE}))`

/** Unread sidebar topics per conversation, including pins across every view. */
export function countsStatement(scope: string | undefined): { readonly sql: string; readonly params: ReadonlyArray<unknown> } {
  return {
    sql: `SELECT i.channel AS channel, c.kind AS kind, count(*) AS n, sum(i.mentions_me) AS mentions ${UNREAD_FROM}${scope === undefined ? '' : ' AND i.channel = ?'}
      GROUP BY i.channel`,
    params: scope === undefined ? [] : [scope],
  }
}
