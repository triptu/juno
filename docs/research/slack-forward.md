# How Slack forwards a message

Research for Juno's Forward… (SPEC section 7, "Forward"). Analysed 2026-10-19. No token, cookie or message content is reproduced here: only method names, field names and code shapes. Claims are marked **observed** (read in shipped code, or seen in the live check), **inferred** or **unknown**.

## Sources and method

- **The web client's code**, from the newest Service Worker cache bucket under `~/Library/Application Support/Slack` (build of 2026-10-16), the way `slack-huddles.md` section 0 reads it. Only JS bundles were read. Short names:
  - `vendors-boot` = `gantry-v2-async-gantry-v2-vendors-boot.218e5d3c8af31581.min.js`
  - `shared-boot` = `gantry-v2-async-gantry-v2-shared-boot.32201340ccb318c2.min.js`
  - `shared` = `gantry-v2-shared.3b03bc2a28796cb1.min.js`
- **Public code** that calls the method: emacs-slack (`slack-message-editor.el`), jollyroger182/ooc (`src/slack/operations.ts`), 3kh0/super-platinum (`crates/super-platinum-core/src/slack/api/forward.rs`, `forwarding/scheduled.rs`), ImShyMike/slack-undoc-client (`src/types.ts`). cgrossde/slackcli's `docs/forward.md` says the method does not exist; the client code shows it does.
- **Event fixtures** from the Haskell `slack-web` package (`forwarded_message.json`, `share_with_message.json`, `share_without_message.json`).
- **The live check** of 2026-10-19, `scripts/forward-live.ts` (`JUNO_LIVE=1 bun run forward:live`): in the self-DM only, it posts a message and a reply, forwards them with and without a note, uploads a 1×1 image and forwards that file-only message, tries two refusals, reads the history and deletes everything it made, the file too. It prints field names and true or false, never values.

## The call

**Observed** in `vendors-boot` (module `Azct`): `createApiMethodFetcher("chatShareMessageFetcher","chat.shareMessage")`, an ordinary Web API call (multipart form POST to `/api/chat.shareMessage`). The Forward dialog's thunk `shareMessage` (`shared-boot`, module `SKKz`) calls `callChatShareMessage` (module `HdPZ`), which sends:

| Field | Value |
| --- | --- |
| `channel` | the conversation the message is in |
| `timestamp` | the message's `ts` (a reply's own `ts`; its `thread_ts` goes only to analytics) |
| `share_channel` | one destination conversation id |
| `client_msg_id` | a new UUID v4 |
| `text` | always `""` |
| `blocks` | the note as `rich_text` blocks, JSON; absent without a note |
| `pending_slug_urls` | a JSON array (link previews being composed); Juno sends none |
| `skip_dlp_user_warning` | `true` only when the call is retried after the user confirms a DLP warning |
| `_x_reason` | `sendShareMessage` |

There is no thread field and no list of destinations: one call per destination, always into the destination's Main.

**Observed, live:** the answer is `{ ok, channel, ts }`, without the message. Slack's client reads only `ts`, to open the new message. It inserts no pending message of its own; the copy arrives through the normal message flow.

**Observed, live:** `share_channel` must be a conversation id. A user id is refused with `channel_not_found`. Slack's client (`getChannelIdForSharing`, `shared-boot` module `GPeC`) opens the DM first with `conversations.open { users, return_im: 1 }`, and joins a public channel the user is not in with `conversations.join` before sharing.

## The message it makes

**Observed, live.** A message by the person forwarding, with no `subtype`:

- `client_msg_id` is the one the call sent. So the echo, history pages and a lookup can match the copy to the request, as for `chat.postMessage` (ADR 0011).
- Without a note: `text` is `""` and there are no top-level `blocks`. With a note: the note's `blocks`, and a `text` Slack derives from them.
- One attachment with `is_share: true`, `is_msg_unfurl: true`, `color: "D0D0D0"`, `ts` (the original's), `channel_id`, `channel_team`, `author_id`, `author_name`, `author_link`, `author_icon`, `author_subname`, `from_url` (the permalink, with `thread_ts` for a thread root or reply), `fallback`, `text` with `mrkdwn_in: ["text"]`, `blocks` (the original's `rich_text`), `footer`, `id`. A thread root also has `is_thread_root_unfurl`, a reply `is_reply_unfurl`; the footer then reads "Thread in …", else "Posted in …".
- **Observed, live:** a forward of a message of only files (no words) has, on the attachment, the original's `files` as whole file objects (thumbnails, `original_w`/`original_h`, `url_private`), and no `text` or `blocks`. Its `fallback` is a line "[date] name: file", the only words Slack gives; a forward with words has the same kind of `fallback` beside `text`.
- In history pages the original's words are in the attachment's `blocks`. Event fixtures and older public code carry them in `message_blocks[0].message.blocks` instead; Juno's attachment parser reads both.
- Forwarding a reply adds nothing to the source thread (its reply count stayed 1).

## Errors

- **Observed, live:** `message_not_found` for a `timestamp` with no message; `channel_not_found` for a user id as `share_channel`.
- **Observed in code** (`handleShareDialogErrors`, `shared-boot` `+9Kv`): `dlp_user_warning` (a warning dialog, then a retry with `skip_dlp_user_warning`), `dlp_processing`, `message_limit_exceeded`, `blocked_file_type` and three `slack_connect_*` file-sharing codes. Anything else is logged.
- **Inferred:** the generic chat refusals (`not_in_channel`, `is_archived`, `restricted_action`) apply as they do to `chat.postMessage`.
- **Observed in code:** before calling, the client refuses to forward a message from a private channel or a DM unless the workspace pref `private_message_forwarding` is on, and refuses a destination the user cannot post in.

## Other forward paths

- "Schedule for later" does not use `chat.shareMessage`: it saves a draft holding the permalink and schedules it, so the posted message shows the permalink's unfurl (`scheduleForwardMessage`, `shared-boot`). **Observed.**
- "Forward as prompt" to Slackbot is an ordinary post with `unfurls: [{ url: permalink }]`. **Observed.**
- No `messages.share` method was found.

## What Juno does with this

Decision `2026-10-19-2213-forward-share-message`. Juno forwards with `chat.shareMessage` and the same fields as the Forward dialog, through the post outbox (architecture 5.7): the forward is a `pending_messages` row in the destination's Main, sent once, and settled by the echo or a lookup that matches `client_msg_id`, as `files.share` is. A person with no DM gets `conversations.open` first, as a send does. Juno does not join channels to forward into them: the list offers only channels the user is in, DMs and people.

## Unknowns

- Whether Slack honours `private_message_forwarding` on the server, or only the client checks it. Juno does not check it; a refusal would show as "Not sent." with Slack's code.
- The exact refusal codes for a destination the user cannot post in, and for a source the user cannot read.
- How a forward of a forward looks, and whether a forward of a message with both words and files carries the files the same way (inferred: it does).
- Whether Slack ever answers `chat.shareMessage` with the message itself.
