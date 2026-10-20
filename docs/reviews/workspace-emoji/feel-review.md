# Workspace emoji verification

Checked on 2026-10-20 on an Apple M2 Mac, after moving Workspace below the standard categories.

`pnpm perf -g 'emoji picker with 2,000 workspace emoji'` passed. Ten opens measured click to the first frame containing the picker grid, including its first workspace query. Median was 16.1 ms, p95 was 29.0 ms, and the range was 8.7–29.0 ms, against the existing 50 ms budget. The one-minute load average was 5.3. Workspace starts offscreen; its rows do not mount until scrolled into view. Images load asynchronously outside the timed region. The test checks fewer than 200 mounted buttons, scrolling to Workspace, full search extent, keyboard focus across unmounted rows, scrolling inside the picker and searching the last custom emoji. This measures the finished browsing grid, not image download time, and is not a speed comparison with the earlier Workspace-first layout.

The local gallery check passed in both themes. It verifies Workspace follows every standard category, offscreen custom rows remain unmounted, all eight distinct images load after scrolling and the alias has no separate cell. The screenshots show the full picker scrolled to Workspace:

- `/Volumes/AgentWork/juno-workspace-light.png`
- `/Volumes/AgentWork/juno-workspace-dark.png`

`pnpm affected --max-specs 0` passed typecheck, all 11 lint checks, the affected unit tests, 126 gallery checks and all 12 reaction desktop tests. Cached checks from the earlier feature verification were retained. No final-run tests were flaky. The desktop flows cover alias search, canonical `reactions.add` names, authenticated picker and chip images, missing images, recent use, Settings selection and Juno reactions stored by name.

The earlier `pnpm test:feel -g 'react to a Juno bubble'` passed four checks over 52 recorded frames, with no layout shift or flicker. That scenario covers standard quick reactions, whose behavior is unchanged by this follow-up.
