# Integration message shapes

Read-only probe, 2026-10-16: `JUNO_LIVE=1 pnpm probe:live --only integrations`.
The probe reads 30 messages from each of the first 24 channels returned by
`client.counts`, then selects four by descending bot-message share. It never
uses channel names. This bounded sample is not a workspace-wide census.

Selected samples: 30/30, 29/30, 4/30 and 2/30 bot messages. Across 65 bot
messages there were 74 attachments. Title, text and color each appeared on 72.
Title link, pretext, fields, footer, timestamp, actions, image URL, thumbnail URL,
author name and nested attachment blocks each appeared on zero.

Block counts across messages and attachments: section 56, context 78,
actions 29, rich_text 37; header, divider and image each zero.

`packages/slack-schema/test/fixtures/recorded/integrations/` holds the census
and eight shape-only samples. Every string value is replaced, including enum
values, and numbers are zeroed. These document structure; they are not valid
wire messages. Parser tests and the fake-server e2e use invented, valid content.
GitHub-like and Linear-like labels describe synthetic examples, not provider
identification from the sample. Alert fields, footer dates and images are
synthetic coverage for cases not observed here.

## Shared Slack messages (10-17)

A message shared or linked from another conversation arrives as an attachment
with `is_msg_unfurl`, `author_name` and `author_icon`, `from_url`, `ts`, a
`footer` such as "Thread in Slack conversation" or "Posted in #channel", the
words as mrkdwn `text`, again in `fallback` ("[date] Name: words"), and as rich
text in `message_blocks[].message.blocks`. This comes from Slack's API shape;
no live sample was recorded. The owner saw the words drawn twice. The parser now
reads `message_blocks` and attachment `blocks`, and draws `text` only when they
give nothing, as a message's own body does. Unknown: which of the two block
fields the owner's message carried; both are covered by
the shared-message rows of `packages/richtext/test/inbound.corpus.test.ts`. A share also carries `is_share`
and the source's `channel_id` (and sometimes `channel_name`), and a reply's
`from_url` carries `?thread_ts=…&cid=…`, also from Slack's API shape, not a
live sample. Juno names the place from its own data by `channel_id`, else by the
channel in `from_url`, and keeps Slack's footer when it does not know the
place.

## Buttons on a Slackbot message (10-26)

Sources: the official client's web bundle (the copy cached by the Slack
desktop app, read statically), and `scripts/ephemeral-live.ts`, run three
times on 10-26 in a private test channel made for it (`juno-ephemeral-test`).
The script mentions a member who is not in the channel; in a private channel
that person is not told. It clicks only Dismiss.

**The message.** When you mention people who are not in the channel, Slackbot
sends you an ephemeral message on the socket only: `type: message`, `subtype:
bot_message`, `is_ephemeral: true`, `user: USLACKBOT`, a `bot_id`, `username`,
`text`, a `rich_text` block and one legacy attachment. It never appears in
`conversations.history`. The attachment has `id: 1`, a `fallback`, `actions`
and a `callback_id` of the form `consistentephemeralmentions_<user ids>_<n>_0`
(the official client reads the mentioned ids from it, split on `_` and `,`).
Each action has `id`, `name`, `text`, `type: button`, `value` and `style`
(empty). In the private channel the buttons were `invite` "Add them" (with a
`confirm` object), `ignore` "Dismiss" and `dont-show-again` "Don’t show
again". The owner saw "Add Them", "Let Them Know" and "Dismiss" in a public
channel; those names were not recorded.

**A click.** Every button of a legacy attachment goes through one thunk,
`triggerAttachmentAction`, which posts `chat.attachmentAction` with:

- `payload`: JSON of `{ actions: [<the action object as received, plus
  selected_options for a menu>], attachment_id, callback_id, channel_id,
  is_ephemeral, thread_ts, message_ts, prompt_app_install, team_id,
  original_request_id, welcome_channel_ids }`; undefined fields drop out.
  `team_id` is the message's `bot_profile.team_id`.
- `client_token`: `web-<Date.now()>`.
- `service_id`: the message's `bot_id`; `app_id`: the app's, when known;
  `bot_user_id`: the message's `user`.

The client marks the button pending at once and shows a spinner after 1 s.
When the answer has neither `replaced` nor `deleted` it clears the pending
state. On an error it posts its own Slackbot-style ephemeral with Slack's
`response` text or "Oh no, something went wrong. Please try that again."
A button with `confirm` asks first.

**Dismiss, live.** The answer is `{ ok: true }` alone. Within a second the
socket sends `message` / `message_deleted` with `deleted_ts` equal to the
ephemeral's `ts`, `hidden: true` and no `previous_message`. The same happens
without `service_id`.

**Unknown.** What Add Them and Let Them Know send back: clicking either reaches
another person, so neither was run. The client's code expects a click to
replace or delete the message (the `replaced` and `deleted` answer fields).
Juno handles a new ephemeral at the same `ts` (it replaces the stored one) and
`message_deleted`. `JUNO_LIVE=1 bun scripts/ephemeral-live.ts --add-them --user
<id>` clicks Add them for a person who agreed to be added, and prints the
frames. Whether a third-party app's button needs `service_id` and `app_id`:
Juno sends `service_id` and leaves out `app_id`.

**Ephemeral messages in Juno.** An ephemeral message is never in history, so
Slack's client loses it on reload. Juno stores it for its topic only: it never
sets a sidebar row's preview, activity, unread count or mention, never
notifies, and the store drops it when it opens.
