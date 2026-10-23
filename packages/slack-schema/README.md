# @juno/slack-schema

One Slack vocabulary. Effect Schemas for every payload Juno reads or sends, and the branded message timestamp `Ts`. See `docs/architecture.md` section 3 and `docs/research/slack-data-access.md` for what the payloads are.

## Public API

- Method definitions: `Methods`, `MethodName`, `isMethodName`. Each method has an args schema and an ok-response schema.
- Payload schemas by area: `boot`, `conversations`, `users`, `message` and `blocks` (`rich_text` in full, the layout blocks bots use, and `table` with its rows of `rich_text`, `raw_text` or `null` cells, `column_settings`, `caption` and `is_caption_visible`), `threads`, `chat`, `search`, `files`, and socket frames in `rtm` (`RtmFrame`, `encodeRtmFrame`).
- `Ts` and its helpers: `isTs`, `compareTs`, `maxTs`, `minTs`, `tsToMillis`, `millisToTs`. A `Ts` is a string of the form `<seconds>.<6 digits>`; compare it with these helpers, never as a number or with `<`.

The getView envelope keeps `threads` as unknown entries. Consumers decode each with `ThreadView`, so one unfamiliar thread cannot reject the page.

Decoding is tolerant. Unknown keys are dropped. Unknown block elements and socket frame types decode to `{ type: 'unknown', raw }`, so a new Slack feature degrades instead of failing a whole message. Encoding is used by `@juno/fake-slack`, so the fake cannot drift from what the client expects.

## Must not

- Import anything but `effect` (`allowedDeps` is empty).
- Contain logic beyond schemas and the `Ts` helpers: no I/O, no product rules, no view models.
- Be duplicated. `richtext`, `domain`, `store`, `slack` and `fake-slack` import their Slack shapes from here; `domain` re-exports `Ts`.

## Testing

`bun run --cwd packages/slack-schema test`. The tests decode and encode representative payloads and check the `Ts` helpers. Real payloads recorded by the live smoke are redacted before they become fixtures; never commit tokens, cookies or message content.
