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
