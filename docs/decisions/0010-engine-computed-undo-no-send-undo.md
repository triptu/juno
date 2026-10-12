# 0010. Undo is computed by the engine per command; sends have no undo, but own messages can be edited and deleted

Status: accepted, 2026-10-12. Changes the undo paragraph of ADR 0003.

## Context

v1 gave the renderer a static table of inverse routes (`resolve` ↔ `reopen`, and so on). The review pointed out that compound commands break this: Resolve also marks the topic read and clears the Reopened tag, and `reopen` restores neither. v1 also made ⌘Z on a routed post or a ⌘K send delete the Slack message, which others may already have seen. The owner decided that sends have no undo and that editing and deleting one's own messages must ship in M6.

## Decision

Every command handler runs in one transaction and returns `{ undo?: Command }`, computed from the state before the change. `topic.resolve` returns an undo that restores `resolved_at`, `resolved_activity_ts`, `reopened_at` and the read pointer together; `channel.ignore`, `topic.unsubscribe`, `topic.pin`, `topic.markRead` and friends do the same. The renderer's undo stack stores up to 20 returned commands and replays the last one on ⌘Z or the toast's Undo; it never computes an inverse itself.

`message.send`, `message.edit`, `message.delete`, reactions and uploads return no undo. The toast for a routed post reads "Posted in …" with no Undo. Deleting a message asks for an inline confirmation in the hover toolbar; editing is inline in the message list. Both go through the outbox with `depends_on` for messages that are still pending.

## Consequences

- Undo is exact and stays correct when a command grows, because the inverse is built next to the forward change and tested with it.
- The renderer stays dumb: store, replay, pop.
- The spec's "Undo the last … routed post" line in the shortcuts table no longer applies; the spec should be updated to say sends are final and editable.
- The inventory's toast copy "Posted in … · Undo" becomes "Posted in …".
