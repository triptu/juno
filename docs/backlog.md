# Backlog

Small items noticed during work that are not yet assigned to a milestone. Remove an item when it is done.

- Identity-provider sign-in (Google, Okta) leaves slack.com and is blocked by the sign-in window allow-list. The Slack-app import covers it for now.
- The socket does not use the system proxy yet: main resolves it, but no `ws` agent is passed.
- `pnpm smoke:live` always imports from the Slack app; it cannot reuse `secrets.bin` outside Electron.
- After the body-sniff sign-in fallback, `secrets.bin` keeps `userId: ''` until a later sign-in.
- A lint rule that bans raw colour and size values in components (StyleX does not enforce token use).
- Dark and tinted macOS 26 app icons. electron-builder 26.15 supports an Icon Composer `.icon` file in `mac.icon` (it compiles it with `actool`, which needs Xcode 26 or newer, and still bundles `icon.icns`). We ship the light `.icns` only. A hand-written `.icon` compiled, but its dark fill was ignored, so author it in Icon Composer from `assets/icon.svg` and `assets/icon-dark.svg`, check the dark and tinted looks, then point `mac.icon` at it.
- Layout-shift guard: the helper and the gallery test exist (`@juno/testing`), and the feel suite (`pnpm test:feel`) covers sidebar hover, tab switch, live messages and image loads in the app. Still to wire into the perf harness.
- Break passes with the `interfaces:break` skill at each UI milestone end, plus a final pass before shipping.
- Edits, deletes and reactions during a socket drop are recovered only for thread text (search sweep) or when a topic is opened. Decide after the live smoke whether `cached_latest_updates` (ADR 0011) is usable.
- The live smoke has not yet confirmed `search.modules.messages` with `is:thread after:` for an `xoxc` session (architecture 5.3, open question 17.2). `SyncConfig.discovery: 'history'` is the fallback.
- `topics.list` p95 is 6.7–9 ms inside the engine while events land (budget 5 ms). The cost is JavaScript row shaping, not SQL.
- Confirm search-based thread discovery (`is:thread after:`) works with an `xoxc` session in the live smoke.
- Edits and deletes made during a socket drop are recovered only for thread text (via search). Opening a topic, and the reconnect refresh of open topics, fetch only messages newer than the stored ones, so an edit to an older stored message is not recovered either. `cached_latest_updates` is still unknown.
- Sync: `subscriptions.thread.getView` returns 10 threads per page regardless of `limit` (32 calls on the real workspace). Consider paging in parallel within the lane budget.
- Cold boot on the real workspace takes about 7 minutes to reach `live` (sidebar data complete after 29 s) because of the 1.5 s background lane spacing. Revisit the spacing once the rate-limit behaviour is measured.
- AI: the eval's expectations test the direction of each judgement, not calibration. Before the assistant fixes its confidence thresholds, collect a few hundred real decisions from the classifier and check its probabilities against them.
- AI: `routeCheck` has a 1.5 s budget that only the classifier meets. With the classifier preference empty, the chat model answers in about 1.5 s and the check mostly times out; either accept that or give the chat path its own budget.
- AI: the first decision of a process pays DNS and TLS to OpenRouter (0.3 s idle, more under load) and misses `routeCheck`'s 1.5 s budget once in the live eval. If that shows in use, keep a connection warm from the assistant (an undici agent with a longer keep-alive) or accept the single miss.
- AI: the assistant's preferences UI needs a third model slot (`classifier`) next to `decision` and `generation`, or a switch that empties it.
- Quint specs (queued after M3 fix A): `specs/` with follow/unfollow and read-state models first, then merge ordering and outbox/echo reconciliation before M6. Run the model checker in CI, feed generated traces into the engine convergence test, and add the "update the spec with sync changes" rule to CLAUDE.md.
- Orchestration: T3 auto-resumes delegated tasks after a rate-limit reset. Before restarting a stopped task elsewhere, cancel the original task (task_cancel) so two agents never share a worktree.
- ui: `EmptyState.tsx` is skipped by the React Compiler (`step++` inside a closure); rewrite so it compiles.
- ui: `activateHandlers` follow-ups and the `ScrollArea` gutter and hover rule from the M3 code review.
- Sidebar times should use domain `relativeTime` (needs a `desktop → domain` edge decision).
- "View all topics" does nothing until the All topics page lands (M5).
- Main rows: engine field for "threads started since Main was last read" (contract + topics query), wired to the TopicRow `newThreads` prop. After M4 WP1 merges.
- Topic art track: placeholder is a library of free-form Tide-style shapes picked per topic, no container (owner decision 10-13).
- Topic view: the message's mention tint does not count the user's groups (`@group`), because the engine does not keep the groups from `client.userBoot` outside the sync. Keep them in `team` or hand them over through `SyncLink`.
- Topic view: bot messages show the bot id as the sender name: `messages` does not keep `username` or `bot_profile`. Store the bot's name with the message.
- Feel pass, still to add: a scenario for adding a reaction from the hover toolbar once the app mounts it (M6), Juno chat once it has a surface, and running the suite in CI with stored filmstrips to compare against.
- Session durability: sign-in does not wait for main to finish writing `secrets.bin` before publishing ready. An immediate quit can race persistence; the relaunch test now waits for the saved session. Add a storage acknowledgement before reporting sign-in complete.
- Sign-out: one loaded baseline run stalled after sync stopped, with Sign out disabled and the session still signed in. It did not recur in 40 loaded runs after the driver fix. Capture teardown stages if it returns.
