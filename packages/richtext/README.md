# @juno/richtext

Pure text handling between Slack and the UI. See `docs/architecture.md` section 9.

## Public API

- Incoming: `messageBody(content, lookups)` turns a message (`{ text?, blocks?, files?, attachments? }`, which a decoded `@juno/slack-schema` `Message` satisfies) into a `MessageBody`. `rich_text` blocks win; mrkdwn `text` is the fallback. `bodyFromBlocks`, `bodyFromMrkdwn` and `mrkdwnInlines` are the parts.
- `MessageBody` is a tree of blocks (paragraph, quote, code, list, heading, divider, file) and inlines (styled text, link, user, channel, usergroup, broadcast, emoji, date, break). Mentions arrive already named through `Lookups`; a missing lookup falls back to the raw id so nothing renders blank.
- Text views: `plainText`, `previewText`, `previewLine` (quotes stripped), `inlineText`.
- Outgoing: `composeOutgoing(text, targets)` turns composer text into `rich_text` blocks plus a fallback `text`. People and channels the composer picked arrive encoded as `<@U…|Maya>` and `<#C…|eng>` and are sent by id; an edit's `@Name` and `#channel` are found through `targets`; `> ` lines become quotes.
- Emoji: the shortcode table and helpers (`emojiUnicode`, `reactionDisplay`, `PICKER_EMOJI`, `QUICK_REACTIONS`). `customEmojiLookup(rows)` resolves workspace image URLs and aliases from the `emoji` table; missing targets and cycles keep their shortcodes. Pass the lookup as `Lookups.emoji`.

Unknown inline elements (`file`, `canvas`, `message_mention`, future ones) decode to `{ type: 'unknown', raw }` in the schema; richtext keeps their `text` or `fallback`.

`date` inlines carry epoch seconds, the Slack format, readable fallback text and an optional link. Dates without fallback text use ISO text. `file` blocks carry `id`, `name`, `mimetype` and optional positive `width`/`height`, using original dimensions before thumbnail dimensions. Views reserve the image box from these fields and resolve the id through main. Legacy attachments keep their title, text and fields; fallback text is read only when those are absent. File names appear in plain text and previews.

## Must not

- Import anything but `@juno/slack-schema` (types). No React, no I/O, no store, and no `effect` beyond `{ Schema }` (`check-deps` enforces it).
- Define Slack payload types of its own. They come from `@juno/slack-schema`.

## Testing

`pnpm --filter @juno/richtext test`. Table-driven tests with real payload shapes: `decode.test.ts` (a payload decoded with `Schema.decodeUnknownSync(Message)`, including an unknown element, then rendered), `rendering.test.ts`, `outgoing.test.ts`, `emoji.test.ts`, and `content.test.ts` (dates, files, attachment text and workspace emoji). Use redacted or invented text, never real message content.

Integration attachments retain titles and links, mrkdwn bodies, two-column fields,
context, images, footer dates and URL actions. Fallback text is used only when
there is no structured content. `messageTitle` uses a structured title for an
empty root or an integration event summary. Otherwise it keeps the original
mrkdwn so title readers can resolve mentions when names arrive. Unknown blocks retain text and URL
buttons become links; Juno never invokes interactive callbacks.
