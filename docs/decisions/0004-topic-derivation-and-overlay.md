# 0004. Topics are derived from Slack data; Juno-only state is an overlay that is never written to Slack

Status: accepted, 2026-10-12. Revised in v2 with the owner's decisions on sidebar membership, Resolve, and pinned resolved rows.

## Context

Slack has no topic. Juno needs one per thread, one Main per conversation, and client-only groupings of Main messages. It also adds titles, resolution, pins, Juno-side unsubscribe, ignored channels, notification rules and digest settings. The spec requires that nothing Juno invents is written back to Slack. Slack does have native concepts for following a thread and for read state.

## Decision

A topic is a derived view with a string id: `t:<channel>:<thread_ts>`, `m:<channel>`, `g:<channel>:<group_id>`. A `topic_index` row is maintained by exactly one function, `reindexTopics(ids)`, called at the end of every transaction for the topics it touched; nothing else writes the index, and no counter is incremented in place. Status and the Reopened tag are computed by a pure function in `@juno/domain`.

The sidebar is activity-driven (owner decision): every thread with recent activity in a channel the user is a member of appears, plus each conversation's Main, whether or not Slack says the thread is followed. "Unsubscribe" is an explicit Juno action that sets the overlay flag and also unfollows in Slack. Resolve is local only plus a mark-read mirrored to Slack; it never unfollows. A pinned topic always shows in Pinned; when resolved it is dimmed with a check and has no hover Resolve.

Juno-only state lives in `user.db` (`topic_overlay`, `main_groups`, `ignored_channels`, `notification_*`, `prefs`) and is never mirrored. Read state is Juno's `topic_reads`, mirrored to Slack through the outbox where a call exists, with the conflict rule in the architecture document.

## Consequences

- Title, resolve, pin, group and ignore never change anything another Slack user can see.
- Discovering threads the user does not follow costs history calls at boot and needs a discovery source for activity during downtime; the search spike in the architecture document decides which.
- Juno's data is not recoverable from Slack; it lives in the durable `user.db` with migrations (ADR 0008).
- The index can always be rebuilt from the mirror; an engine test checks incremental and full rebuild agree.
