# Slack's activity feed: reactions to your messages

What Juno learned about `activity.feed`, the internal method behind Slack's Activity tab, for the sidebar's Reactions view (SPEC 5, "Reactions"). Observed with read-only calls on the cached session, 2026-11-07, printing counts and value shapes only (probe scripts kept outside the repo, under the scratch volume's `juno-batch2/reactions-activity/` and `juno-batch2/reactions-view/`).

## The call

`POST /api/activity.feed` with the client token (`xoxc`), form fields:

- `mode=chrono_v1`, `types=message_reaction`, `limit` (20 and 50 answered; 100 answered `invalid_arguments`), `cursor` from `response_metadata.next_cursor`, and `archive_only=false`, `unread_only=false`, `priority_only=false` as the web client sends them.
- Other types mix in with a comma (`message_reaction,at_user,thread_v2,dm`); Juno asks for reactions only.
- `reactions.list` refused the client token (`not_allowed_token_type`), so the feed is the only listing of reactions to your messages.

## The answer

`{ ok, items, response_metadata: { next_cursor }, activity_views_date_updated }`. Each item:

- `feed_ts`: a Slack timestamp (`<seconds>.<6 digits>`), the time of the latest reaction on that message.
- `item`: `{ type: 'message_reaction', message: { channel, ts }, reaction: { name, user } }`, the message and that latest reaction only. The other reactions are on the message.
- `key` (`message_reaction-…-<feed_ts>`), `version`, `is_unread`, `is_archived`.

Observed over 750 entries (16 pages) and then 3,000 (61 pages, reaching back 103 days without an end):

- One entry per message: no message had two entries, and 749 of 750 `feed_ts` values were distinct.
- Newest first by `feed_ts`, always.
- `feed_ts` is 2 seconds to 9.4 days after the message's own ts, never before it.
- No entry for your own reactions.
- A page took about 1.3 s (median 1,310 ms, max 1,417 ms).
- Of the newest 30 entries, every reaction was still on its message when read back; 12 were replies.

## Reading the message

The entry does not say whether the message is a reply. `conversations.replies` with the message's ts as `ts`, `oldest` and `latest` (`inclusive`, `limit: 2`) answered for a top-level message (the message alone) and for replies (the thread's root first, then the reply), so Juno uses it for every message it lacks. Its root carries `subscribed` and `last_read`, as the root fetch relies on.

## How Juno uses it

- The engine reads one page of 50 while the Reactions view is subscribed: when it opens, and each time the socket connects again. It stores entries newest first and stops at the first one it already has. Nothing polls.
- `reaction_added` on the socket, for a message of yours (`item_user`, or the stored message's author) by someone else, stores the same row while Juno runs.
- The view reads people and emoji from the message's stored reactions. A row whose reaction the store may not have yet (`fetched_at` below `at`) has its message fetched once; until then the feed's own reactor shows.

## Unknowns

- Whether an entry goes away or keeps its `feed_ts` when the latest reaction is taken back. Juno keeps the row's time and lets the message's reactions decide who shows; a message with no one else's reaction left drops out.
- Whether the feed lists reactions in channels you have left, or in Slack Connect channels. Ignored channels are left out by Juno.
- The rate limit tier. Juno reads at most one page per open or reconnect.
