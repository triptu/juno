# Workspace emoji verification

Run on 2026-10-20 against the implementation in `3854f67fe` and `6e50f1fe7`, on an Apple M2 Mac.

`pnpm perf -g 'emoji picker with 2,000 workspace emoji'` passed. Ten opens measured click to the first frame containing a custom emoji. Median was 9.8 ms, p95 was 34.1 ms, and the range was 8.6–34.1 ms, against the existing 50 ms budget. The one-minute load average was 3.0. The timed result is the finished picker grid, including its first workspace query. Images finish loading asynchronously. The test checks that fewer than 200 buttons mount, the full search list has its expected scroll extent, keyboard focus crosses unmounted rows, scrolling stays inside the picker, and an emoji at the end of the set is searchable.

`pnpm test:feel -g 'react to a Juno bubble'` passed all four checks over 52 recorded frames. The quick reactions stay at their anchor from frame 9, the badge arrives without moving the bubble, and no layout shift or flicker appears in the filmstrip. The recording lasts 869 ms with load 7.6. This existing scenario covers standard quick reactions; the fake-Slack desktop tests cover custom picks and their image badges.

The three reaction desktop specs passed all 12 tests against fake Slack. These cover a name and alias pick sent to `reactions.add`, loaded picker and chip images, missing images, recent use, Settings selection, and a Juno reaction stored and sent to the model by name. The focused picker gallery run passed all 45 checks after native sticky headers replaced virtualized headings. Existing emoji and output-parser tests passed all 20 checks.

The first affected run could not acquire remote runner capacity. Its local fallback found a cold-boot call-count failure (two `api.getFlannelHttpUrl` calls instead of one); the focused rerun of that spec passed all 45 tests. The initial gallery header jump and two desktop test assumptions were corrected and rechecked.

The final `pnpm affected --max-specs 0` passed typecheck, all 11 lint checks, the affected unit tests, 276 gallery checks and all 12 reaction desktop tests. This final run covers the changed desktop specs; the earlier broader desktop selection had 71 passing cases. No tests were flaky in the final run.
