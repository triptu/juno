# Backlog

Small items noticed during work that are not yet assigned to a milestone. Remove an item when it is done.

- Identity-provider sign-in (Google, Okta) leaves slack.com and is blocked by the sign-in window allow-list. The Slack-app import covers it for now.
- The socket does not use the system proxy yet: main resolves it, but no `ws` agent is passed.
- `pnpm smoke:live` always imports from the Slack app; it cannot reuse `secrets.bin` outside Electron.
- After the body-sniff sign-in fallback, `secrets.bin` keeps `userId: ''` until a later sign-in.
- A lint rule that bans raw colour and size values in components (StyleX does not enforce token use).
- Dark and tinted macOS 26 app icons. electron-builder 26.15 supports an Icon Composer `.icon` file in `mac.icon` (it compiles it with `actool`, which needs Xcode 26 or newer, and still bundles `icon.icns`). We ship the light `.icns` only. A hand-written `.icon` compiled, but its dark fill was ignored, so author it in Icon Composer from `assets/icon.svg` and `assets/icon-dark.svg`, check the dark and tinted looks, then point `mac.icon` at it.
- Layout-shift guard: the helper and the gallery test exist (`@juno/testing`). Still to wire into the app e2e (sidebar hover, tab switch, live message, image load) and the perf harness.
- Break passes with the `interfaces:break` skill at each UI milestone end, plus a final pass before shipping.
- The 300-row `topics.list` snapshot is 346 KB on the large seed (budget 200 KB), mostly participant names and avatar URLs repeated per row. If the UI track keeps the self-contained row, add a `people` live value and carry ids in rows; see architecture 16, M3.
- Edits, deletes and reactions during a socket drop are recovered only for thread text (search sweep) or when a topic is opened. Decide after the live smoke whether `cached_latest_updates` (ADR 0011) is usable.
- The live smoke has not yet confirmed `search.modules.messages` with `is:thread after:` for an `xoxc` session (architecture 5.3, open question 17.2). `SyncConfig.discovery: 'history'` is the fallback.
- `emojis/list` into the `emoji` table is not synced yet (architecture 5.2 step 6).
- `topics.list` snapshot is 346 KB on the large seed (budget 200 KB). Plan: rows carry person ids only, plus a separate `people` live value with names and avatar URLs.
- `topics.list` p95 is 6.7–9 ms inside the engine while events land (budget 5 ms). The cost is JavaScript row shaping, not SQL.
- Confirm search-based thread discovery (`is:thread after:`) works with an `xoxc` session in the live smoke.
- Edits and deletes made during a socket drop are recovered only for thread text (via search) or when the topic is opened. `cached_latest_updates` is still unknown.
- Sync: `subscriptions.thread.getView` returns 10 threads per page regardless of `limit` (32 calls on the real workspace). Consider paging in parallel within the lane budget.
- Cold boot on the real workspace takes about 7 minutes to reach `live` (sidebar data complete after 29 s) because of the 1.5 s background lane spacing. Revisit the spacing once the rate-limit behaviour is measured.
- AI: evaluate TypeSafe System One decision models (served on OpenRouter through pi-ai's `classify` API) for the decision tier. The spec suggests a decision-model approach like this.
- AI: OpenAI-compatible reasoning models keep their default reasoning effort, which may miss the 1.5 s decision budget. Set effort low for the decision tier if such a model is chosen.
- AI: evaluate TypeSafe System One decision models (served on OpenRouter through pi-ai's `classify` API) for the decision tier. The spec suggests a decision-model approach like this.
- AI: OpenAI-compatible reasoning models keep their default reasoning effort, which may miss the 1.5 s decision budget. Set effort low for the decision tier if such a model is chosen.
- Quint specs (queued after M3 fix A): `specs/` with follow/unfollow and read-state models first, then merge ordering and outbox/echo reconciliation before M6. Run the model checker in CI, feed generated traces into the engine convergence test, and add the "update the spec with sync changes" rule to CLAUDE.md.
- Orchestration: T3 auto-resumes delegated tasks after a rate-limit reset. Before restarting a stopped task elsewhere, cancel the original task (task_cancel) so two agents never share a worktree.
