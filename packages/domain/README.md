# @juno/domain

Pure product rules. No I/O, no Effect services, no React. The same code runs in the engine, the renderer and tests. See `docs/architecture.md` section 3 and `docs/design/handoff/SPEC.md`, which decides behaviour.

## What it holds

- Branded ids (`ChannelId`, `UserId`, topic ids `t:<channel>:<thread_ts>`, `m:<channel>`) and the message timestamp helpers, re-exported from `@juno/slack-schema`.
- `Topic`, status (`open`, `quiet`, `resolved`, `unsubscribed`, `ignored`), pinning, unread and visibility rules. The sidebar rule of spec section 5 is `sidebarPlacement`: Main when the channel had activity of any kind inside the quiet window (`latestActivityTs` counts thread replies through `activity.channelLastActivityTs`), a thread only when followed in Slack (`isFollowed`, from `slackSubscribed`) or carrying an unread mention (`hasUnreadMention`), every pinned topic. `isSubscribed` is what Subscribe and Unsubscribe toggle: the follow flag for a thread, the client-only flag for Main.
- Title resolution, sidebar and All topics sorting, relative time.
- The shared vocabulary as `Schema.Literals`, declared once here and re-exported by `@juno/contract` for the wire: `ConversationKind`, `ContextTint`, `TopicKind`, `RowTag`, `AllTopicsStatus`, `ChannelIcon` and `ChannelColor`. A channel's default icon and hue (`defaultChannelStyle`, `defaultPersonColor`) use the keys `@juno/ui` draws (`channelIcons`, `hueNames`), so no layer translates them.
- `reindexTopics` inputs: the topic index row computed from source rows.
- The read-state merge rule and the notification decision order.
- Clarity and audience checks before send.
- The command palette grammar (`parseCommand`, with `confidenceLabel`), mention detection, context menu item lists.

Import from `@juno/domain`; everything is exported from `src/index.ts`.

## Must not

- Do I/O, read the clock (take `now` as a parameter), or hold state.
- Import `effect` except `{ Schema }` for branded ids and shared shapes (`check-deps` enforces it), or React.
- Import anything but `@juno/richtext` and `@juno/slack-schema`.
- Encode a tuning constant as a contract. Confidence numbers and thresholds may change; tests check order and ranges, not exact values.

## Testing

`pnpm --filter @juno/domain test` (vitest, `test/*.test.ts`). Tests build topics with `test/fixtures.ts` and assert behaviour: a resolved topic with later activity shows the reopen tag, an ambiguous command scores below an unambiguous one. Prefer table-driven cases from the spec's examples.
