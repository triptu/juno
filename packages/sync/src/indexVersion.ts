/**
 * `bun run lint` checks reindex.ts and its transitive local dependencies
 * against the branch point with main and requires a higher version when
 * they change, including preview and richtext rules.
 *
 * The meaning of `topic_index` rows. Bump it when a stored column changes
 * meaning or the rule would give a stored topic a different row; the next
 * start re-indexes every stored topic from local messages instead of
 * throwing the cache away. A row written under another version is never
 * kept as up to date (`topic_inputs`). 2: `participants_json` holds the
 * senders of the latest unread messages. 3: a preview names user groups
 * ("@handle" or "@group", never the id). 4: a preview without words labels
 * its files ("Image") and stores the sender's namesakes. 5: unread messages
 * cache notification attention for their sender and mention context. 6: a
 * table stored as an unknown block before Juno read tables gives its
 * preview ("Table: Service, Status"). 7: a thread's unread count is exact
 * only when a proven range of its replies reaches back to the read pointer
 * (`thread_ranges`), not when the stored replies reach `reply_count`. 8:
 * Juno's own posts Slack has not stored yet count as the user's messages
 * when queued, so a send moves its topic before Slack answers. 9: a post
 * Slack refused is no activity until it is retried. 10: the draft sync
 * change touched the files the index reads (posts, write, markup); the
 * rows should not differ, and the bump only makes the next start check.
 * 11: live query triggers changed the store's invalidation module, which
 * the index imports; the rows do not differ, as for 10. 12: the outbox
 * fixes (a post back in the queue takes its waiting edit or delete, a
 * discarded root takes its replies) touched posts, actions and started
 * threads, which the index imports; the rows do not differ, as for 10.
 * 13: the outbox fixes for a cut-off follow, a lost file, a lost upload
 * answer and a replaced mark touched posts and the read writer, which the
 * index imports; the rows do not differ, as for 10.
 */
export const INDEX_VERSION = 13
