# Backlog

Small items noticed during work that are not yet assigned to a milestone. Remove an item when it is done.

- `pnpm test` was SIGKILLed once right after `pnpm install` (could not reproduce in 8 runs). Watch for it; if it recurs, find the package and check vitest worker memory and timeouts.
- Identity-provider sign-in (Google, Okta) leaves slack.com and is blocked by the sign-in window allow-list. The Slack-app import covers it for now.
- The socket does not use the system proxy yet: main resolves it, but no `ws` agent is passed.
- `pnpm smoke:live` always imports from the Slack app; it cannot reuse `secrets.bin` outside Electron.
- After the body-sniff sign-in fallback, `secrets.bin` keeps `userId: ''` until a later sign-in.
- A lint rule that bans raw colour and size values in components (StyleX does not enforce token use).
- Dark and tinted macOS 26 app icons. electron-builder 26.15 supports an Icon Composer `.icon` file in `mac.icon` (it compiles it with `actool`, which needs Xcode 26 or newer, and still bundles `icon.icns`). We ship the light `.icns` only. A hand-written `.icon` compiled, but its dark fill was ignored, so author it in Icon Composer from `assets/icon.svg` and `assets/icon-dark.svg`, check the dark and tinted looks, then point `mac.icon` at it.
- Gallery: adopt the state-machine pattern (states grouped in product terms, switcher beside the component, `__state` links, loading states held, each view lists only states its code can reach). Starts after the look update merges.
- Layout-shift guard: a test helper that records `layout-shift` entries during an interaction and fails on any shift. Use it in gallery behaviour tests (hover/press/focus every interactive fixture), app e2e (sidebar hover, tab switch, live message, image load) and the perf harness.
- Break passes with the `interfaces:break` skill at each UI milestone end, plus a final pass before shipping.
- The 300-row `topics.list` snapshot is 346 KB on the large seed (budget 200 KB), mostly participant names and avatar URLs repeated per row. If the UI track keeps the self-contained row, add a `people` live value and carry ids in rows; see architecture 16, M3.
- Edits, deletes and reactions during a socket drop are recovered only for thread text (search sweep) or when a topic is opened. Decide after the live smoke whether `cached_latest_updates` (ADR 0011) is usable.
- The live smoke has not yet confirmed `search.modules.messages` with `is:thread after:` for an `xoxc` session (architecture 5.3, open question 17.2). `SyncConfig.discovery: 'history'` is the fallback.
- `emojis/list` into the `emoji` table is not synced yet (architecture 5.2 step 6).
