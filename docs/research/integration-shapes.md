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
`packages/richtext/test/attachments.test.ts`. A share also carries `is_share`
and the source's `channel_id` (and sometimes `channel_name`), and a reply's
`from_url` carries `?thread_ts=…&cid=…`, also from Slack's API shape, not a
live sample. Juno names the place from its own data by `channel_id`, else by the
channel in `from_url`, and keeps Slack's footer when it does not know the
place.
