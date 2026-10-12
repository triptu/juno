# @juno/richtext

Pure text handling between Slack and the UI. See `docs/architecture.md` section 9.

## Public API

- Incoming: `messageBody(content, lookups)` turns a message (`{ text?, blocks? }`, which a decoded `@juno/slack-schema` `Message` satisfies) into a `MessageBody`. `rich_text` blocks win; mrkdwn `text` is the fallback. `bodyFromBlocks`, `bodyFromMrkdwn` and `mrkdwnInlines` are the parts.
- `MessageBody` is a tree of blocks (paragraph, quote, code, list, heading, divider) and inlines (styled text, link, user, channel, usergroup, broadcast, emoji, break). Mentions arrive already named through `Lookups`; a missing lookup falls back to the raw id so nothing renders blank.
- Text views: `plainText`, `previewText`, `previewLine` (quotes stripped), `inlineText`.
- Outgoing: `composeOutgoing(text, targets)` turns composer text with `@Name`, `#channel` and `> ` lines into `rich_text` blocks plus a fallback `text`.
- Emoji: the shortcode table and helpers (`emojiUnicode`, `reactionDisplay`, `PICKER_EMOJI`, `QUICK_REACTIONS`). Custom emoji come from the caller.

Unknown inline elements (`file`, `canvas`, `message_mention`, future ones) decode to `{ type: 'unknown', raw }` in the schema; richtext keeps their `text` or `fallback`.

Not built yet: `MessageBody` has no `date` or `file` nodes, and `attachments` and `files` are not read.

## Must not

- Import anything but `@juno/slack-schema` (types). No React, no I/O, no store, and no `effect` beyond `{ Schema }` (`check-deps` enforces it).
- Define Slack payload types of its own. They come from `@juno/slack-schema`.

## Testing

`pnpm --filter @juno/richtext test`. Table-driven tests with real payload shapes: `decode.test.ts` (a payload decoded with `Schema.decodeUnknownSync(Message)`, including an unknown element, then rendered), `rendering.test.ts`, `outgoing.test.ts`, `emoji.test.ts`. Use redacted or invented text, never real message content.
