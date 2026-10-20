# @juno/richtext

Pure text handling between Slack and the UI. See `docs/architecture.md` section 9.

## Public API

- Incoming: `messageBody(content, lookups)` turns a message (`{ text?, blocks?, files?, attachments? }`, which a decoded `@juno/slack-schema` `Message` satisfies) into a `MessageBody`. `rich_text` blocks win; mrkdwn `text` is the fallback. `bodyFromBlocks`, `bodyFromMrkdwn` and `mrkdwnInlines` are the parts.
- `MessageBody` is a tree of blocks (paragraph, quote, code, list, heading, divider, file) and inlines (styled text, link, user, channel, usergroup, broadcast, emoji, date, break). Mentions arrive already named through `Lookups`. A person with no name reads "Someone"; a user group with no handle reads the `|@handle` label from the text, else "@group", never its id. A usergroup inline carries the group's `name` for a tooltip and `isMine` when `Lookups.myUsergroups` lists it.
- Text views: `plainText`, `previewText`, `previewLine` (quotes stripped), `inlineText`.
- Outgoing: `composeOutgoing(text, targets)` turns composer text into `rich_text` blocks plus a fallback `text`. People and channels the composer picked arrive encoded as `<@U…|Maya>` and `<#C…|eng>` and are sent by id; an edit's `@Name` and `#channel` are found through `targets`; `> ` lines become quotes.
- Markup (`markup.ts`, SPEC section 8): Slack's `*bold*`, `_italic_`, `~strike~`, `` `code` ``, ```` ``` ```` code blocks and `> ` quote lines, read as Slack's client reads them with "Format messages with markup" on. A marker opens at a line start or after a character that is not a letter or digit, with no space after it, and closes at the nearest same marker with no space before it and no letter or digit after it; a doubled marker is text at either end (including `*bold**`); boundaries read Unicode code points; backslash escapes markup punctuation; styles nest and stay on one line; nothing inside code is markup; mentions, links and shortcodes hold no markers. Three backticks open a code block anywhere outside a quote line and the next three close it, across lines; an unclosed or empty one is text. One grammar serves three callers: `composeOutgoing` sends styled runs as `text`, mention, link and emoji elements with a `style`, a code block as `rich_text_preformatted` with `border: 0` (only picked mentions and linked words are elements inside it), and keeps the markup as typed in `text` with a code block as "```code```" (research section 5, "Styles, observed live"); typed URLs and emoji inside code stay text; explicitly linked words keep their link. `markupLayout(text, opaque)` gives the field's look (styled runs, markers, code blocks, quote lines), with the picked names and linked words it shows as `opaque`. `toggleMarkup(text, selection, style)` is the edit a formatting key makes.
- Editing: `editMarkup(content, lookups)` writes each inline as readable markup and escapes literal markers, backslashes and backticks inside code. `composeEdit(text, original, lookups, targets)` parses that source with the original message. It retains original elements outside the changed source range, and untouched inline elements in an edited paragraph. This preserves shapes that markup cannot spell, such as adjacent styles inside a word, styled edge spaces, lists, dates and unknown elements. Changed elements use the typed markup. An unchanged edit returns the original rich-text blocks. Engine edits must call `composeEdit`, not `composeOutgoing`.
- Links: `findLinks(text)` finds URLs with a scheme, email addresses and bare domains on a short list of top-level domains ("example.com", not "index.ts"), trimming the sentence's closing punctuation and a markup marker that closes an open style on the line (`_https://example.com/a_b_` links `https://example.com/a_b`); `linkOf(text)` says whether a paste is one link. `composeOutgoing` sends them as Slack's client does (research section 5): a URL typed with its scheme as `{ type: "link", url }` and `<url>`, an address or domain with its scheme added and its text kept (`<http://example.com|example.com>`), and the composer's `<url|words>` as `{ type: "link", url, text }`. An edit's linked words are linked again through `targets.links`. Incoming text elements that hold a URL (bots, Juno before links) render it as a link too, except in code.
- Emoji: the shortcode table and helpers (`emojiUnicode`, `reactionDisplay`, `PICKER_EMOJI`, `QUICK_REACTIONS`). `customEmojiLookup(rows)` resolves workspace image URLs and aliases from the `emoji` table; missing targets and cycles keep their shortcodes. Pass the lookup as `Lookups.emoji`.

Unknown inline elements (`file`, `canvas`, `message_mention`, future ones) decode to `{ type: 'unknown', raw }` in the schema; richtext keeps their `text` or `fallback`.

`date` inlines carry epoch seconds, the Slack format, readable fallback text and an optional link. Dates without fallback text use ISO text. `file` blocks carry `id`, `name`, `mimetype` and optional positive `width`/`height`, using original dimensions before thumbnail dimensions. Views reserve the image box from these fields and resolve the id through main. Legacy attachments keep their title, text and fields; fallback text is read only when those are absent. File names appear in plain text and previews.

## Must not

- Import anything but `@juno/slack-schema` (types). No React, no I/O, no store, and no `effect` beyond `{ Schema }` (`check-deps` enforces it).
- Define Slack payload types of its own. They come from `@juno/slack-schema`.

## Testing

`pnpm --filter @juno/richtext test`. Table-driven tests with real payload shapes: `decode.test.ts` (a payload decoded with `Schema.decodeUnknownSync(Message)`, including an unknown element, then rendered), `rendering.test.ts`, `outgoing.test.ts` (the markup rules and the edit round trip too), `edit-roundtrip.test.ts` (Slack-origin and generated edit preservation), `markup.test.ts` (the formatting keys and the field's look), `links.test.ts`, `emoji.test.ts`, and `content.test.ts` (dates, files, attachment text and workspace emoji). Use redacted or invented text, never real message content.

Integration attachments retain titles and links, mrkdwn bodies, two-column fields,
context, images, footer dates and URL actions. A shared Slack message (`is_share`
or `is_msg_unfurl` with a `from_url` permalink) gets a `source`: its place's kind
and name from the `place` lookup, the permalink, and `thread` when the link carries
another message's `thread_ts`; its footer is then only the date. Without a known
place the footer is Slack's own text as a link to the permalink. Fallback text is used only when
there is no structured content. `messageTitle` uses a structured title for an
empty root or an integration event summary. Otherwise it keeps the original
mrkdwn so title readers can resolve mentions when names arrive. Unknown blocks retain text and URL
buttons become links; Juno never invokes interactive callbacks.

## Slack-origin edit coverage

The shapes below come from [research section 5](../../docs/research/slack-data-access.md#5-messages-content-and-rendering) and the fake server’s rich-text fixtures. `test/edit-roundtrip.test.ts` checks them with invented content, plus 150 generated combinations both unchanged and with punctuation changed in another paragraph.

| Original shape | Edit rule |
| --- | --- |
| Plain `*literal*` | Escape its markers; parsing alone keeps literal text. |
| Plain `foo`, bold `bar`, plain `baz` | Keep untouched original inline elements; markup has no word boundary here. |
| Code containing a backtick | Escape the backtick. |
| Preformatted text containing triple backticks | Escape the content backticks; fences stay delimiters. |
| Styled whitespace, styled mentions and links | Retain the original elements when their displayed source is untouched. |
| Multiline quote, ordered list, date, emoji | Retain untouched original blocks and inline elements, including their metadata. |

New messages use `composeOutgoing`. Only edits have original elements to preserve. The fallback `text` is composed from the edited source; `blocks` remain authoritative.
