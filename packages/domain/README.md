# @juno/domain

Pure product rules. No I/O, no Effect services, no React. The same code runs in the engine, the renderer and tests. See `docs/architecture.md` section 3 and `docs/design/handoff/SPEC.md`, which decides behaviour.

## What it holds

- Branded ids (`ChannelId`, `UserId`, topic ids `t:<channel>:<thread_ts>`, `m:<channel>`) and the message timestamp helpers, re-exported from `@juno/slack-schema`.
- `Topic`, status (`open`, `quiet`, `resolved`, `unsubscribed`, `ignored`), pinning, unread and visibility rules. The sidebar rule of spec section 5 is `sidebarPlacement`: Main when the channel had activity of any kind inside the quiet window (`latestActivityTs` counts thread replies through `activity.channelLastActivityTs`), a thread only when followed in Slack (`isFollowed`, from `slackSubscribed`) or carrying an unread mention (`hasUnreadMention`), every pinned topic. Main has no follow.
- Message headers: `startsGroup(prev, next)` takes `{ senderId, body, isThreadRoot, startsAfterDivider?, broadcast? }`. The first message, a sender change, a quote, a thread root or an unread divider starts a header. A reply also sent to the channel starts a header, and so does the message after it. `threadLinkLabel(replyCount)` returns "Thread", "1 reply" or "N replies"; the view adds a known first-reply preview and chevron. `mainLabel(ChannelInfo)` returns "#eng · Main" or the DM equivalent.
- Title resolution, sidebar and All topics sorting, relative time.
- The shared vocabulary as `Schema.Literals`, declared once here and re-exported by `@juno/contract` for the wire: `ConversationKind`, `ContextTint`, `TopicKind`, `RowTag`, `AllTopicsStatus`, `ChannelIcon` and `ChannelColor`. A channel's default icon and hue (`defaultChannelStyle`, `defaultPersonColor`) use the keys `@juno/ui` draws (`channelIcons`, `hueNames`), so no layer translates them.
- `reindexTopics` inputs: the topic index row computed from source rows.
- The read-state merge rule, the notification decision order, and `dockBadgeActive`, the dock badge policy built on the alert decision, with sidebar visibility and unread DMs.
- Clarity and audience checks before send, and which messages the checks read (`sendChecksApply`: not empty, at most 1,000 characters).
- The composer's colon emoji: the query at the caret (`composer-emoji.ts`), shared search and ranking for the picker and the colon list (`emoji-ranking.ts`: exact names and whole name or curated words first; for queries of at least three characters, whole CLDR or phrase words before mere name prefixes; then frequent, quick and popular emoji within a tier; SPEC 8), and composer choices from the shared alias resolver (`custom-emoji.ts`). `emoji-picker.ts` prepares immutable browse data and alias-aware selection lookup.
- `rankConversations`: conversations ranked by own sends and topic visits, each counting half as much per week over the last 30 days, then by activity, for the ⌘K Conversations tab.
- The command palette grammar (`parseCommand`, with `confidenceLabel`), mention detection, context menu item lists.

Import from `@juno/domain`; everything is exported from `src/index.ts`.

## Must not

- Do I/O, read the clock (take `now` as a parameter), or hold state.
- Import `effect` except `{ Schema }` for branded ids and shared shapes (`check-deps` enforces it), or React.
- Import anything but `@juno/richtext` and `@juno/slack-schema`.
- Encode a tuning constant as a contract. Confidence numbers and thresholds may change; tests check order and ranges, not exact values.

## Testing

`bun run --cwd packages/domain test` (`bun test`, `test/*.test.ts`). Tests build topics with `test/fixtures.ts` and assert behaviour: a resolved topic with later activity shows the reopen tag, an ambiguous command scores below an unambiguous one. Prefer one table per rule, with rows from the spec's examples.

Only tricky rules get a unit test: ordering, precedence, parsing, time zones, the read-state machine. Labels, menu item lists and other copy are not tested here; the e2e specs click the real menus (`menus.spec.ts`, `topic.spec.ts` for Notify me, `views.spec.ts` for view order and Add to view). Pass a time zone to anything that formats a time; the notification hours read the host zone, so their tests check local weekday and minutes rather than fixed instants.
