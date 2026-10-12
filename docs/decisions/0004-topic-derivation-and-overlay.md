# 0004. Topics are derived from Slack data; Juno-only state is an overlay that is never written to Slack

Status: proposed, 2026-10-12

## Context

Slack has no topic. Juno needs one per thread, one Main per conversation, and client-only groupings of Main messages. It also adds titles, resolution, pins, Juno-side unsubscribe, ignored channels, notification rules and digest settings, none of which Slack can store. The spec requires that nothing Juno invents is written back to Slack.

Slack does have native concepts for two things Juno exposes: following a thread (`subscriptions.thread.add/remove`) and read state (`conversations.mark`, `subscriptions.thread.mark`).

## Decision

A topic is a derived view with a string id: `t:<channel>:<thread_ts>`, `m:<channel>`, `g:<channel>:<group_id>`. Sync maintains a `topic_index` row (last activity, counts, participants, preview) in the same transaction as the message write, so list queries are single indexed reads. Status (`open | quiet | resolved | unsubscribed | ignored`) and the Reopened tag are computed by a pure function in `@juno/domain` from the index, the overlay and the clock.

Juno-only state lives in `topic_overlay` (one nullable row per topic), `main_groups`, `ignored_channels`, `notification_*`, `prefs`. These tables are never mirrored to Slack. The two concepts Slack does have are mirrored: Subscribe/Unsubscribe on a thread calls Slack's follow API and also sets the overlay flag (Juno's flag drives visibility, Slack's drives the bell and server notifications); read state is Juno's `topic_reads` first and mirrored to Slack through the outbox where a matching call exists. Sidebar visibility is activity-driven: threads with recent activity in channels the user is in appear whether or not Slack says they are followed, until the user unsubscribes in Juno (open question 1 in the architecture document).

## Consequences

- Title, resolve, pin, group and ignore never risk changing anything another Slack user can see.
- Resolve is cheap to undo and never affects the official client.
- Discovery of threads the user does not follow needs `conversations.history` per active conversation at boot; the sync section budgets for it. If the product owner chooses "followed threads only", that step drops and boot is cheaper.
- Deleting Juno's data loses titles, resolutions and rules; they are not recoverable from Slack. Syncing the overlay across devices is a later decision (spec open question).
- The index must be rebuilt on schema changes; a `rebuild_index` migration step is part of the store.
