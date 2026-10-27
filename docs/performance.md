# Performance

Version 1, October 2026. This document sets the speed budgets for Juno, says how to hit them, and says how they are measured so a change that breaks them fails the build. `docs/architecture.md` decides structure; where this document asks for a structural change, the architecture is updated in the same milestone. Agents load `.claude/skills/performance/SKILL.md` for the short rules; this is the detail.

The goal in the owner's words: the app must feel native and insanely fast. In practice that means three things. Input shows a result on the next frame. Nothing the user sees waits for Slack. Scrolling never drops frames.

Reference hardware: a base M1 MacBook Air (8 GB) with a 120 Hz display assumed, so a frame is 8.3 ms. CI runs on GitHub's `macos-26` runner, which is slower; section 8 explains how the two are kept comparable.

## 1. Budgets

Every budget is a p95 over the runs of the scenario in section 8 unless marked p50. A one-frame budget (written 16 ms: the prefetched open, the tab switch, hover) is one refresh interval plus 8 ms: 16.3 ms at 120 Hz and 24.7 ms at 60 Hz, because the wait for the next refresh is part of the measurement (section 8). "Painted" means the frame that shows the result is presented, measured from the user input event (`pointerdown`, `keydown`) or from process launch.

| Metric | Budget | Notes |
| --- | --- | --- |
| Cold start → window visible with the shell (sidebar bar, tab strip, empty list) | 400 ms p50, 600 ms p95 | From `app` launch to the first presented frame. The shell is static chrome; it needs no data. |
| Cold start → first sidebar rows painted from the local cache | 800 ms p50, 1 200 ms p95 | Large workspace, OS file cache warm. Slack is not contacted before this point. |
| Warm start (second launch within a minute) → first sidebar rows | 500 ms p50 | V8 code cache and OS caches hot. |
| First sign-in → first sidebar rows (quick start) | 5 s | Empty cache, large seed, 300 ms per Slack call, production pacing. The rows are the cold boot's quick steps (`userBoot`, `prefs`, `counts`, DM names, the first `getView` page): followed threads titled from their first words, and channels and DMs from `client.counts`. History, replies, search and users fill in after, with no reload. Asserted by `quick start` in `perf.spec.ts` (slowest of three); the flow itself, rows before any history and filling in without a reload, is checked by `first-sync.flow.test.ts`, with no timing gate. `bun run bench:sync --latency 300` prints the engine side. |
| First sign-in → channel previews | 10 s after the quick start | Same setup. One or two newest-first searches after the quick start (`searchPreviews`, `@juno/sync` discovery) give the busiest channels a preview before their history is read. The order is asserted by `packages/engine/test/flows/quick-start.flow.test.ts` with history held; no test gates the time. |
| First sign-in → every active conversation in the sidebar | 30 s | Every member conversation with activity in the window has its row, from `client.counts` (a provisional Main until its history lands). Live 23 to 25 s on 147 conversations (10-17). Measured by `bun run sync:timeline`, live; not asserted in CI. |
| First sign-in → unread counts exact for unread DMs and mentions | 1.6 s per DM, group DM and channel that mentions you, after the quick start | DMs and group DMs are read first, the unread ones first, then the channels that mention you (`historyOrder`: the owner's order of 10-16 with unread before read inside it), and each page makes its count exact. Live the 3 unread DMs were exact at 6.4 s and the mention, behind 51 read DMs, at 84.8 s (10-18). Measured by `bun run sync:timeline` (`unreadDmsAndMentionsRight`), live; the order is asserted by `sync.test.ts`. |
| First sign-in → no unread count left as a dot | 1.6 s per DM, group DM and unread conversation after the quick start | The unread followed threads and the other unread channels come next. Live 111.7 s for 73 conversations (10-18), 170.7 s with the 10-16 order. |
| First sign-in → Home ready | 1.6 s per DM, group DM, conversation with an unread mention and conversation with unread followed threads, after the quick start | Home is ready once those have history, the `getView` pages are stored and the preview search is done (`sync_state.homeReady`, owner 10-18): the syncing line goes and Home's checks and AI titles start, while the rest of history fills in. Live 86.1 s, behind 54 DMs and 1 mention, instead of 235.9 s at the boot's end (10-18). Measured by `bun run sync:timeline` (`homeReady`), live; `first-sync.flow.test.ts` checks on the fake that Home is ready before the rest of history. |
| First sign-in → history for every active conversation | 1.6 s per active conversation | One `conversations.history` page per conversation at 40 a minute, DMs, mentions, unread followed threads and other unread channels first, so this is the pacing itself: live 222 s for 146 (1.50 s apart, 10-17). Exact unread counts follow each conversation's page. |
| Last history page → first sync ended | 30 s | The boot is recorded (Automated's job and its record may start; Home was ready before) and the sync cycle ends (the sidebar is no longer busy). Nothing that has a clock of its own waits for history: thread previews and emoji run beside it, so only the discovery search (three pages at 10 a minute, 13 to 21 s live) and the last users remain. Live 21 s after the 10-17 fixes, 83 s (boot) and 174 s (cycle) before. `first-sync.test.ts` checks the order on the fake with the app's pacing. |
| Topic open, cached (rows already in `cache.db`) | 50 ms | `pointerdown` on a row → messages painted at the right scroll position. 16 ms when the topic was prefetched (section 4.2). |
| Topic open, uncached (never synced) | 50 ms to header and empty body; no spinner before 300 ms | Messages arrive whenever Slack answers; the list must not shift when they do. |
| Search: an arrow or a press on a result → reader painted | 50 ms, as a cached topic open | The header and the result in the frame the selection moves, never the last topic's messages. The rows before and after the selection and the hovered row are warm (4.2), so the topic paints at the match from the cache. A topic not local yet shows the result's own message from its row where the match lands, and its rows fill in around it without moving it. Slack is asked only once an arrow has stayed 120 ms, so a held arrow loads one topic. `juno.search-reader`, whose `reader` detail says which painted; `search.perf.spec.ts` asserts the budget and that warm arrows paint the topic. |
| Home open (the sidebar's Home button, from a topic) | 50 ms | `pointerdown` → Home painted with its greeting and rows from the local cache. A tab switch to a mounted Home is the tab switch budget. Asserted by `home open` in `perf.spec.ts` over the opens that follow 300 ms after the last action. |
| Home open after idle | 150 ms | The same open after 31 s with no input. The owner set this separate budget on 10-17: after idle the CPU clock on the reference Mac drops and the same work takes 5 to 13 times as long (observed 32 to 121 ms before the prefetch below, 11 to 134 ms after). Asserted by `home open` in `perf.spec.ts` over its five idle opens ("Home open after idle", section 8). |
| New tab with Home (⌘T, the strip's "+") | 16 ms | The press → the new tab's Home painted with its composer focused. One frame, the budget New chat open had until Home took its place (10-17). ⌘N lands on the same composer. Asserted by `a new tab with Home open to its composer painted` in `perf.spec.ts`. |
| Peek open | 16 ms | Peek key `keydown` over a hovered row → the peeked messages painted. The hover warmed the topic's query, so this is a prefetched open. Asserted by `peek` in `perf.spec.ts` on the topic300 seed. |
| Tab switch | 16 ms | One frame. Recently used tabs stay mounted (section 4.3). Unmounted tabs: 50 ms including scroll restore. |
| Sidebar resize drag | p95 frame ≤ 8.3 ms main-thread work; zero long animation frames | Only the sidebar box's inline `width` changes, at most once per frame; nothing re-renders until the drag ends. A custom property on the shell cost 4.7 ms of style recalculation per frame, because every element under it inherits it. Asserted by `sidebar drag` in `perf.spec.ts` on the large workspace with a topic open. |
| Sidebar filter or scope change | 50 ms | Query, delta, render. The old list stays on screen until the new one is ready. |
| ⌘K open | 50 ms | Input focused and recent rows painted. |
| Media viewer open | 50 ms | `click` on a picture in a message (its activating event; a press is held about 60 ms before it) → the viewer painted with the item's thumbnail in its final box and the filmstrip. The budget of the other overlays (⌘K). The chunk is preloaded once a topic has painted; strip images load lazily and the full image fades in later. Measured by `media viewer open` in `perf.spec.ts`. |
| ⌘K keystroke → results painted | 100 ms, typing never blocked | Local FTS only. The AI command parse arrives later and never delays results. |
| Keystroke → character painted (composer, ⌘K, any text field) | Within one refresh interval of a bare `<input>` measured in the same run (8.3 ms at 120 Hz, 16.7 ms at 60 Hz), p95; zero long animation frames while typing | Input event timestamp to its frame's presentation feedback; see 7.1. Until 10-15 this was an absolute 16 ms, which the bare input misses too. Event Timing is diagnostic only. The @ and # suggestions keep to it: each keystroke narrows the last answer in the renderer and the engine's answer follows (`mentions.people`, `mentions.channels`, local only). Measured by `mention typing` in `perf.spec.ts` (each keystroke of "@ma ", against the bare input as the keystroke controls are) and checked by the `mention-typing` feel scenario. |
| Send (Enter) → pending message painted | 50 ms | Only ready wrong-place routing may stop a send; Enter never waits for a model. Text fixes show after sending: local ones as soon as the send is accepted, grammar's whenever its answer comes (within two minutes). The fix line is a row of the sent message and never takes focus. |
| Scroll, sidebar and message list | p95 frame ≤ 8.3 ms main-thread work; zero long animation frames (> 50 ms) in a 3 s scroll at 2 000 px/s; dropped frames < 1 % | Measured with a CDP trace and the LoAF observer. |
| Juno chat: Enter → your bubble painted | 16 ms | One frame (SPEC 13.12). The bubble is the renderer's pending send, shown before the agent stores it. `juno.chat-send`. |
| Juno chat: Enter → Juno's first bubble painted | 2.5 s on OpenRouter | SPEC 13.12. `juno.chat-bubble`; `perf.spec.ts` measures it against the fake OpenRouter, so there it is the agent's own overhead. A Codex turn may be slower and shows the dots meanwhile. The agent's part alone, send to first bubble and an approved card's click to its run's first bubble, is gated at 100 ms p95 by `packages/agent/test/turn-timing.perf.ts` through `bun run perf --unit` (medians 5 and 7 ms, p95 6 to 18 ms over three remote runs, 10-18). |
| Juno panel: ⌘J or the header's Juno button → panel painted with its composer | 16 ms | One frame; with an About chip too (plan v3 §19.3). The topic reflows once. `juno.panel-open`. |
| Juno switcher: a pick → the Juno page painted with its rows, in the tab or the panel | 50 ms | As a cached topic open, with 500 runs stored for Activity. The switch waits for the page's first value (at most 150 ms) and paints the finished page in one frame, never an empty page under the header. Activity reads its newest 50 runs by `runs_by_start`; the agent builds them within 40 ms over 500 runs and the 200-run snapshot stays under 200 KB (`packages/agent/test/activity.perf.ts` through `bun run perf --unit`, with payload and correctness checks in `activity.test.ts`); closed rows are `content-visibility: auto`. `perf.spec.ts` measures the panel's switch to Activity. `juno.page-switch`. Measured 22.5 ms p95 (10-18). |
| Scroll, Juno chat | as the message list | The chat's rows are in flow with `content-visibility: auto`, and its window is the agent's page of at most 200 rows. |
| Live query update, write → pixels | 50 ms | Engine commit → invalidation → query → encode → port → decode → render → paint. Background (socket) updates may add the 30 ms trailing debounce; user commands may not. |
| Engine: one live query run (sidebar window, messages window) | Sidebar window 10 ms p95; All topics' first window 8 ms; messages window 5 ms; FTS query 20 ms | 5 k topics, 100 k messages. Asserted by the engine benchmark with `EXPLAIN QUERY PLAN`, over 50 to 100 runs. On the Mac (10-19) the sidebar query's median is 2.8 ms and its p95 4.0 to 8.6 ms, depending on other work on the machine; All topics' first window is 3.3 ms median and 4.8 to 5.5 ms p95. Both were 5 ms and failed at random. They run in the engine process, so they never block a frame, and both stay well inside the 50 ms filter and page budgets. |
| Engine: one socket event transaction, including `reindexTopics` | 5 ms | Backfill transactions ≤ 200 rows and ≤ 20 ms. |
| Engine: longest synchronous block of the event loop after boot | 50 ms | Boot may parse `userBoot` in one block; nothing after it may. |
| Idle CPU after sync, nothing happening: every process | On the Mac, Main 2 %, window 3 % with a focused text field and otherwise 2 %, graphics 2 %, engine 3 %, Juno agent 2 %, network 1 %, other helpers 1 %, averaged over 60 s. The laptop walk holds every process to 5 % over 4 s. | App diagnostics are the primary way to catch idle spins in the field: Settings › About shows every process, and main logs a process above 30 % of a core for two idle minutes. A short synthetic walk cannot cover every workspace or delayed trigger. `idle-cpu.spec.ts` keeps the fine Mac walk with 10 s settling and 60 s windows (`JUNO_IDLE_WINDOW_MS`). Its portable walk (`@on-demand`) runs in Electron on the laptop only when asked (`bun run remote --env JUNO_ON_DEMAND=1 test:desktop e2e/idle-cpu.spec.ts`): a 2,000-message seed and five states (the first sync waiting on Slack, after sync with an unread mention of a known person, an open topic, a Juno reply and hidden), each with 1 s settling and a 4 s window; the hidden state settles 10 s, past the garbage collection V8 runs about 8 s after the Juno reply. It also checks per-process memory growth; see [the measurements](test-speed-4.md). The large-seed walk with the fine budgets is `@mac` and runs only by hand on the Mac. Every run has two fast checks instead: `packages/engine/test/flows/idle.flow.test.ts` counts the engine's work passes over ten minutes at rest on a test clock, and while an edit backs off with another behind it, and `juno.expectAtRest()` checks over a second that no looping animation, frame loop or (in the browser lane) timer loop runs, on Home and an open topic (`topic.spec.ts`) and after a Juno answer. `idle.perf.ts` and `edit-retry-idle.perf.ts` retain the engine's fine CPU gates through `bun run perf --unit`. |
| Scheduled sync sweep, large seed, no Slack changes | Fewer than 12,000 SQL statements and less than 1 % of one core averaged over its 60 s window | The limit is one fifth of the 60,388-statement baseline. `idle-cpu.spec.ts` reports the scheduled sweep separately from the replacement idle window. Section 8.12 records the statement trace and the Mac reading. |
| Memory after the scroll and memory scenario (large workspace, the sidebar's scroll sweeps) | Renderer private 250 MB, JS heap 120 MB; engine private 300 MB; main 80 MB | `app.getAppMetrics()` and `process.getProcessMemoryInfo().private`, which on macOS is the physical footprint; `perf.spec.ts` reads it with `footprint` for main, the renderer and the engine and holds each to these budgets. On 10-18: main 51 to 53 MB, renderer 167 to 227 MB, engine 76 to 94 MB (8.10). Three repetitions of a scenario must not grow the renderer heap by more than 5 %. |
| Memory after heavy use (large workspace: 20 topics opened, 50 tab switches, 2 minutes of mixed scrolling, the Juno panel opened and closed), read after 30 s idle | Renderer private 300 MB; engine private 300 MB; main 80 MB | `memory after heavy use` (`e2e/perfMemory.ts`). The renderer has 50 MB more here (owner, 10-18): its overage over 250 MB is Chromium's allocators keeping the pages freed after a scrolling peak, which nothing in the app holds; five fixes were tried and none removed it (8.11). On 10-18: main 51 to 63 MB, renderer 265 to 294 MB, engine 113 to 125 MB. |
| Renderer bundle | Initial JS ≤ 1,200 KB uncompressed (1.0 MB until 10-16, raised once React DOM and Effect alone were about 650 KB of it, and to 1,200 KB on 10-27, when the channel and giphy merges had used the last of 1,100 KB; warm start and topic open stay the real gates), CSS ≤ 200 KB, minified (155 KB until 10-20, when StyleX's sheet was first minified: the same styles went from 157.9 to 130.3 KB, so figures before that date are unminified; 150 KB until 10-19, raised for the huddle views: StyleX puts every style in the one initial stylesheet, lazy chunks' too); secondary surfaces are lazy chunks; the default New chat frame and composer stay eager | The built shell ships 1,101.0 KB of JS (372.7 KB gzip) in one file and 144.8 KB of CSS with app pictures that open in the viewer and context-block icons (2026-10-27; 1,099.2 KB before them, with channel create, edit, join and leave; 1,103.5 KB when the two merged as written: the channel sheet's save and messages, Leave channel…'s question and the join and leave toasts became lazy chunks). It shipped 1,087.3 KB of JS (367.6 KB gzip) and 144.7 KB of CSS on Vite 8 (2026-10-25, "Vite 8 first screen" below; 1,098.4 KB and 145.0 KB on Vite 7 at `5a4b2f8f`). It shipped 1,058.3 KB of JS (358.7 KB gzip) and 137.2 KB of CSS after the 2026-10-22 startup pass below. It shipped 1,098.9 KB of JS and 137.2 KB of CSS with the sidebar's reorder motion (2026-10-22 review; 1,099.6 KB on `origin/main` at `2594be98`: the motion rule, observer and player load on idle; native topic and message menu construction and Redraw art feedback also moved to idle, keeping the 1,100 KB budget); 1,077.1 KB of JS (364.8 KB gzip) and 130.3 KB of CSS, StyleX's sheet minified, with Home's picture, the picture page and the gallery (2026-10-20; 157.9 KB of CSS unminified: the pages add about 3.6 KB over the 154.3 KB `origin/main` had. The picture's state and view add about 3 KB of eager JS; picking, downloading, the catalog and both pages are lazy chunks); 1,098.9 KB of JS and 153.2 KB of CSS with code colours (2026-10-20; 1,098.0 KB and 151.6 KB on `origin/main` at `512df355`: the painter, 2.6 KB, is a lazy chunk loaded when a code block mounts, the highlight worker, 156.9 KB, starts with the first block near the screen, and the CSS is the `::highlight` rules, the `syntax` variables and the no-ligatures rule, ADR 0017); 1,067.4 KB of JS (361.2 KB gzip) and 151.6 KB of CSS after the 10-20 startup split (below); 1,089.1 KB of JS and 150.7 KB of CSS with huddles (2026-10-19; 1,082.9 KB and 147.6 KB on `origin/main` then: the bar, the header control, the tab and the media service are lazy chunks, and the Chime SDK loads only on join); 1,067.7 KB of JS (361.0 KB gzip) and 145.0 KB of CSS with Home's thought (2026-10-18; 1,063.6 KB and 144.5 KB at `8eeb40f1` before it: the thought's logic and view add 4.1 KB, its list is a lazy chunk); 1,058.5 KB of JS (358.1 KB gzip) and 144.4 KB of CSS, minified, at `627f74b1` (2026-10-18); 1,054.6 KB of JS (356.6 KB gzip) and 143.3 KB of CSS earlier that day, after Home's review sheets became their own chunk and `SheetLayer` left `BackupSheets.tsx`, which had pulled the Backup sheets into the start bundle: 1,092.4 KB before; 990.7 KB on 10-17, 969.3 KB on 10-16, 1,054.6 KB before the 10-17 split). `scripts/check-bundle-size.mjs` runs at the end of `bun run build` and fails over budget. Measure before adding a dependency. |
| Live query message size | Snapshot ≤ 200 KB; any delta ≤ 32 KB; encode and decode ≤ 5 ms each side | From architecture 2.6, criterion 5. Larger means the window or the view model is wrong. |

### Vite 8 first screen (2026-10-25)

The renderer builds with Vite 8 and Rolldown. Against `origin/main` at `5a4b2f8f`, Vite 7 gave **1,098.4 KB** of initial JS (377.5 KB gzip) in one file. Vite 8 with no config change gave **1,143.5 KB** (406.4 KB gzip) in 65 files. With the three changes below it gives **1,087.3 KB** (367.6 KB gzip) in one file. CSS is 144.7 KB, against 145.0 KB. The lazy chunks are the same (98 files against 97, 3,902.6 KB of JS in all against 3,948.1 KB), and the build contains `react.memo_cache_sentinel` 555 times in both.

How it was measured: each build wrote hidden source maps, and every byte of every output file was attributed to its source file through its map, then compared source by source. Oxc's minified code was up to 4% smaller than esbuild's for the same source. The rest of the difference came from three places:

- **Common chunks.** Rolldown puts each module the first screen shares with a lazy chunk in a chunk of its own. The first screen loaded 65 files, and their imports and exports were 43 KB. `rendererOutput` in `apps/desktop/renderer.vite.ts` sets one `codeSplitting` group with the `$initial` tag, which puts every module the entry reaches by static imports in the entry's file. What is left is 9 KB more than Rollup's, mostly Rolldown's runtime helpers. Inlining the common chunks instead (`experimentalInlineCommonChunks`) gave 2,363 KB in 13 files.
- **Token groups.** Rollup kept only the keys of a StyleX token group that code reads at runtime, such as `colors['--background-subtle']` in the reorder player. Rolldown keeps every group a chunk imports whole: 21.5 KB against 0.5 KB. The `juno:inline-token-reads` plugin replaces each such read with its value, `'var(--background-subtle)'`, so no chunk imports the groups.
- **Static imports, not used code.** `$initial` follows imports before tree shaking. `inline.ts` imported `emoji.ts` for `emojiInline`, which nothing on the first screen calls, and that put the 36 KB emoji catalog in the first file; `emojiInline` now lives in `emoji.ts`. This holds for every module: when a first-screen module imports a lazy-only module, even for code that never runs at start, the lazy-only module is in the first file. Rollup left such a module out. The bundle check catches a large one; a per-source comparison of two builds shows which.

### React Compiler through Oxc (2026-10-26)

The React Compiler moved from Babel to Oxc's port (section 5.4). Initial JS went from 1,087.7 KB (367.9 KB gzip) to **1,087.0 KB** (367.6 KB gzip); CSS stayed 144.7 KB. On this Mac, one `bun run perf -g "launch"` run on each build of the same tree (Vite 8, five warm launches each): warm start to sidebar rows **529.8 ms median** (range 524.7–738.9, load 4.7) with Babel and **582.8 ms** (553.7–608.8, load 4.0) with Oxc; launch to a focused composer 502.2 and 564.1 ms; snapshot to rows 41.9 and 31.1 ms. Most of the difference is before the page starts. From navigation to rows took 213–323 ms (median 247) with Babel and 241–281 ms (median 262) with Oxc. The ranges overlap, so one run of each shows no regression and no gain. Both miss the 500 ms warm-start median, which was red before this change.

### Startup bundle room (2026-10-22)

Against `origin/main` at `7a0954d89d`, the build budget check reads **1,097.8 → 1,058.3 KB** of initial JS (gzip **371.7 → 358.7 KB**). The unchanged 1,100 KB limit has **41.7 KB free**. CSS remains **137.2 KB** (42.3 KB gzip). These are the final files loaded by `index.html`, including Vite's preload code; the temporary Rollup report ran before Vite added that code and must not replace the budget check's total.

A temporary `generateBundle` report recorded every chunk's modules and `renderedLength`. Its largest startup modules, **before final minification**, were React DOM's client (644.6 KB), Effect (98.4 KB), Effect's internal runtime (80.9 KB), Schema (74.3 KB), SchemaAST (72.7 KB), Channel (48.0 KB), Queue (29.1 KB), AtomRegistry (25.8 KB), Message (25.1 KB), TopicRow (24.9 KB), MessageBody (24.3 KB), navigation (21.6 KB), Sidebar (20.6 KB) and HomeComposer (20.2 KB). The React/Effect client, message rendering, sidebar and composers support the first frame or cached topic and stay eager. These module lengths are attribution, not independent removal savings.

The deferred boundaries are:

- Home's Send to list loads on composer idle. The shared option-list implementation leaves startup with it; destination labels and row ids stay eager. The All topics place filter now lives with that existing lazy page, separate from Home's visible destination chips.
- Message and selection toolbar contents shared a `chunk()` boundary, warmed on workspace idle. The message menu replaced the hover toolbar (10-22): the selection bar is small and eager, and the menu's own chunk warms on idle after a message list paints (`preloadMessageMenu`).
- Channel-menu construction warms on workspace idle. The menu entry point and notification bridge stay eager. (Notification explanations warmed here too until the why popover was removed with the message menu, 10-22.)
- Juno's image decoding, thumbnail generation and text-file reading warm on composer idle. The attachment state and send coordination stay eager; a file arriving earlier also starts the import.
- The agent's wire codecs and flattened RPC client load through one scoped atom runtime on demand and warm on workspace idle when Juno is available. The runtime and port ownership are unchanged. Plain chat text and selection helpers live separately from schemas, so the composer does not pull the chat wire models back into startup.
- The one-shot topic selection read stays eager for ⌘J. The selection follower, held range and Juno panel hooks load with the existing Juno chunk on workspace idle.

Settings, onboarding, huddles, Juno's views, reactions, emoji, the media viewer, syntax highlighting and the developer log already had deferred boundaries. No emoji data changed. The final Rollup audit found no nonempty source module emitted into multiple chunks. React and Effect each resolve to one installed version; icons use per-icon imports with the existing weight pruning, dates use native `Intl`, and no new dependency was added. Temporary build instrumentation was removed.

### Startup bundle headroom (2026-10-20)

`JUNO_COVERAGE=1 bun run build` against `origin/main` at `05a0bcf76` measured initial JS at **1,097,997 → 1,067,448 bytes** (1,098.0 → 1,067.4 KB; gzip 372.2 → 361.2 KB). The unchanged 1,100,000-byte budget has 32,552 bytes free. CSS stays at 151.6 KB. `scripts/check-bundle-size.mjs` supplies these totals: the scripts and module preloads in the built `index.html`, uncompressed. Hidden source maps do not change those bytes.

Source-map attribution of the minified entry, rounded to KB:

| Package | Before | After |
| --- | ---: | ---: |
| React DOM | 211.3 | 211.3 |
| Effect | 189.7 | 189.7 |
| Views | 181.6 | 173.7 |
| Desktop containers | 144.1 | 141.7 |
| Phosphor icons | 101.5 | 101.5 |
| UI primitives | 93.9 | 89.2 |
| State | 71.7 | 71.7 |
| Agent contract | 33.0 | 17.4 |
| Contract | 27.6 | 27.6 |

The largest eager app modules were Juno's fixed copy (16.3 KB), Message (12.9 KB), TopicRow (11.9 KB), MessageBody (11.2 KB), Sidebar (10.6 KB) and HomeComposer (10.1 KB). Messages, sidebar rows and Home's composer belong to the first screen and stay eager. Settings, the media viewer, huddles and the Juno UI already had lazy boundaries.

Two changes free the room:

- `shellCopy.ts` holds only the labels Home, topic actions and tab titles need. The rest of `chatCopy` loads with the existing Juno and setup chunks, warmed on idle. Previously a few labels kept the whole object in the entry.
- `SignedOut.tsx` loads sign-in and its appearance controls together through `chunk()` and `usePreloaded`. It warms on idle after the shell mounts, or immediately when the session is known to be signed out, and shows only once ready. The entry no longer contains AppearanceSettings (3.9 KB), Session (2.4 KB), SignInView (1.8 KB), SignInPage (1.4 KB), SessionView (0.7 KB), Segmented (1.8 KB), Swatch (1.6 KB) or Logo (1.3 KB). The account menu shares Session through its own preloaded chunk. On 10-21 the sign-in page gained its highlights, pebble art and motion: the chunk and its imports (SignedOut, Session, SignInPage, AppearanceSettings, Segmented, Swatch) went from 15.3 KB (7.2 KB gzip) to 24.5 KB (10.8 KB gzip), the entry from 1089.0 to 1089.4 KB and the CSS from 128.7 to 132.6 KB. The pebbles are inline SVG from `pebbleShape`, which the entry already holds for topic rows; `Pebble` and the art opt out of the React compiler (`'use no memo'`), since they render once. The art's motion does no work while the window is idle: the entrance runs once, the parallax writes a transform at most once a frame and only while the pointer moves, and the busy pulse runs only while the session is being read, including while the macOS password prompt has focus.

These module sizes are attribution, not independent removal savings: shared code and generated glue make the build's total reduction the authoritative number. Home and topic frames and composers stay eager.

The focused `bun run perf` run passed seven of eight scenarios on this Mac (60 Hz, 24.7 ms for a one-frame budget). It ran through the exclusive lock with reported loads of 2.6–4.0. First opens in a relaunched app measured account menu 15.6 ms, topic switcher 6.5 ms, emoji picker 26.9 ms and Settings 16.9 ms (one sample each). Other p95 readings: Home 19.1 ms, Home after idle 27.2 ms, new tab with Home 20.3 ms, palette open 19.0 ms, Juno panel 19.0 ms (first open 20.8 ms), and Activity 18.3 ms. Juno chat send was 24.0 ms, its first reply 156.2 ms, and continuous scroll work 5.0 ms with no long frames. Selection drag work was 4.1 ms with and without the panel, with no long frames.

Warm start missed the 500 ms median gate: 539.3 ms to sidebar rows over five launches, range 510.5–602.1 ms. Shell median was 412.9 ms. A separate unchanged-main check also missed it (520.2 ms median, range 483.9–938.5 ms), but its load rose from 4.5 to 9.1 and it reported contention. An earlier main check had load 9.2 too. Those comparisons do not establish whether startup regressed. No startup speedup is claimed, and the startup check remains red.

The seven selected feel scenarios passed, including launch, relaunch during session checking, Home after idle, account and topic popovers, palette and the Juno tab and panel. The launch filmstrip has its composer from frame 1 and zero Home frames without it. That run started at load 6.7 but later reached 15.9, so it supplies visual and geometry checks, not a timing comparison.

`bun run affected --spec e2e/session.spec.ts,e2e/layout-shift.spec.ts,e2e/notifications.spec.ts` passed typecheck, lint, 741 unit tests, 201 gallery tests and 90 desktop tests (three platform skips). The remote plan ran once. No new unit tests were added.

### Startup bundle split (2026-10-16)

`bun run --cwd apps/desktop build`, against `origin/main` at `404ffb34`, measured initial JS at **999.7 KB → 969.3 KB** (gzip **324.0 KB → 313.9 KB**). This frees 30.4 KB without changing the 1,000 KB budget. CSS is 124.1 KB (35.4 KB gzip), from 124.0 KB.

A temporary Rollup `generateBundle` hook inspected each chunk's `modules` and `renderedLength`; no dependency or build instrumentation remains. These lengths are before final minification: React DOM (644.6 KB) and Effect dominate the entry, followed by required message and sidebar code. Candidates evaluated for splitting included DestinationPickers (18.5 KB), the New chat container (9.7 KB), ViewSheet (9.4 KB), TopicSwitcher (9.9 KB), and AccountMenu (4.9 KB).

| Moved out of initial JS | Built lazy chunk, minified | Loading |
| --- | --- | --- |
| Frequent destination rows | 1.44 KB | Preloaded on idle. The heading, hint and one 32px slot per destination stay in the eager frame. |
| Conversation and thread picker lists | 5.24 KB | Preloaded on idle and on button hover/focus. The picker buttons stay eager; lists open in the existing popovers. |
| New/edit view sheet | 8.41 KB | Preloaded on sidebar idle; opens in the existing popover. |
| Account menu content and its exclusive icons | 7.45 KB | Preloaded on sidebar idle; opens in the existing popover. |
| Topic switcher content | 5.87 KB | Preloaded when the topic's deferred rows have mounted, alongside its existing local query warming. The header and queries remain eager; the list opens in the existing popover. |

Shared picker code also leaves the entry, so the chunk sizes do not sum to the entry reduction. Message rendering (including integration cards and Block Kit), the sidebar, topic view and composer remain eager. Settings, Set up Juno and Configure were already deferred; the small why popover and date helpers stay as they were. The default New chat frame, empty-state hint, composer and picker buttons stay eager. The Frequent list reserves its rows while the chunk loads; its final geometry is unchanged.

The first split put all of New chat behind `lazy()` and reached 946.5 KB, but New chat is the default launch tab. A launch probe found 17–19 animation frames with that tab visible and no composer (median 743.8 ms to a visible, focused composer; range 728.6–780.7 ms, five warm launches). The launch feel filmstrip showed the empty workspace for about 235 ms after recording began. That boundary was removed.

Launch recheck on this Mac: five alternating main/fixed launches under one exclusive `bun run perf` lock, after one warmup per build, using the same signed-in 1,200-topic cached workspace. A temporary preload probe sampled the visible, focused New chat textarea on animation frames and recorded time after that paint, relative to Electron's browser-process creation time. Neither side contacted real Slack. Main (`404ffb34`) measured **546.2 ms median, 502.0–574.8 ms range**; the corrected split measured **510.1 ms median, 492.5–531.5 ms range**. Both had zero New chat frames without the composer. Navigation-to-composer medians were 206.4 and 203.8 ms; most variation was Electron's process-to-navigation time (335.4 and 308.1 ms medians, load average 6.6). The overlapping ranges do not establish a startup speedup; the missing-composer delay is gone. The probe and build-swapping benchmark were removed; `bun run test:feel -g launch` keeps the visual regression check. Its final filmstrip has the composer in frame 1, zero missing-composer frames and no composer movement while Frequent rows fill their reserved space. The Frequent feel scenario, remote desktop and gallery suites, and `bun run affected --base origin/main` passed.

### Bundle split (2026-10-17)

Initial JS grew to **1,054.6 KB** (346.1 KB gzip) with the topic container, media grid, composer links, tooltips, the reactors popover and the unified Home. The splits below bring it to **1,027.6 KB** (337.1 KB gzip) and dropping unused duotone weights to **990.7 KB** (333.4 KB gzip), measured with `bun run --cwd apps/desktop build` against `origin/main` at `c57723fc`. CSS is unchanged at 140.3 KB. Before Home's merge the same splits saved 33.7 KB (1,048.7 to 1,015.0 KB); Home's composer now uses some of the shared list and surface code eagerly, so less of it leaves.

How it was measured: a temporary Rollup hook wrote the module graph, and a build with hidden source maps attributed the entry's minified bytes to source files. `renderedLength` misleads: it counted 24 KB of `@noble/hashes` that the minifier later drops. For each module, removing it from the static graph gave the bytes only it keeps in the entry. Effect (189 KB), React DOM (211 KB) and Phosphor icons (144 KB) are the largest parts; most icons are the channel and view icon sets that sidebar rows need on first paint.

A module is placed whole in one chunk. When the start bundle uses any export of a module, everything in it that a lazy chunk uses stays in the start bundle too. On Vite 8 the start bundle also holds every module a start-bundle module imports, used or not ("Vite 8 first screen"). Two splits were lost that way: New chat (now Home's composer, `homeSendChecks.tsx`) imported `SendCheckPanel` directly, and `mentionRowId` kept `MentionSuggestions` eager.

| Moved out of initial JS | Lazy chunk, minified | Loading |
| --- | --- | --- |
| Send check bar, now shared by Home's composer | 4.9 KB | Idle after a composer mounts, as before; Enter waits for it when a bar is needed. |
| Peeked topic (`PeekTopic`, `PeekView`) | 4.0 KB | Idle after the frame mounts. The key handling stays eager; the peek shows once its topic and the chunk are both ready. |
| @, # and : suggestion list | 6.0 KB | Idle after a composer mounts, and at once when a trigger is typed first. The answer for a bare "@" is asked for at the same idle time and held while the composer is mounted, so the first "@" does not wait on the engine. |
| Sidebar sync status cards (offline, rate limited, stopped, first-sync progress) | 9.5 KB | Idle after the sidebar mounts, and at once when a notice comes first. The footer shows only once they have loaded, so it never shows empty. |
| Message edit field | 2.6 KB | Idle after a topic mounts, and when ↑ selects a message. |
| Composer link editor | 1.7 KB | Idle after a composer mounts, and at once on ⌘K. |
| Composer markup rules and formatting keys (`containers/markupRules.ts`) | 6.2 KB | At mount for a Slack composer; idle for Home before a destination is chosen. Sending never waits for either chunk. Deferred keys capture their field and selection, and cancel on blur or composition. |
| The field's drawing of markup, a block per line (`TextareaLines` in `@juno/ui`) | 3.1 KB | At mount for a field with `marks` or `format`; includes both chip and formatted-line drawing. Until loaded, the layer draws plain text at the same positions. |

Each part shown after input uses `usePreloaded` (`containers/chunks.ts`), which says when the chunk has loaded; the caller draws the part only then, so nothing suspends and nothing shows half-drawn.

Left eager: message content (media grid, file cards, attachments, reactions, the delete confirm), Home and its composer, and the sidebar and its icon sets. The message menu, its icons, its emoji data and what its rows do are the `MessageMenuPanel` chunk (26.3 KB), loaded when idle after a topic or the Juno chat paints, so a first right-click does not wait (`juno.emoji-preload` measures it with the workspace emoji).

**Duotone weights.** Every Phosphor icon ships its duotone weight, which only the Juno sparkle draws in the app. `phosphorWeights` now drops it from every icon `packages/ui/src/duotone.ts` does not import: 36.9 KB uncompressed, 3.7 KB gzip, since the duotone paths repeat the other weights. A missed icon would draw nothing, so it cannot be asked for elsewhere: `IconWeight` has no duotone, a duotone icon is a wrapped icon from `duotone.ts` (`SparkleDuotone`, typed `DuotoneIcon`, which `Card`'s `kindIcon` requires), the build reads that file's imports for its list, and `scripts/check-duotone.mjs` (in `bun run lint`) fails on the weight's name as a string anywhere else and on an icon wrapped there without that import.

Where these numbers come from: 100 ms is the limit under which a response feels immediate and 10 ms per frame is the animation target in Google's RAIL model ([web.dev/rail](https://web.dev/articles/rail)); Juno targets a frame (16 ms, or 8.3 ms at 120 Hz) for direct feedback because native macOS apps do. 50 ms is the long-animation-frame threshold ([Chrome LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames)) and 200 ms is the "good" Interaction to Next Paint limit ([web.dev/inp](https://web.dev/articles/inp)); Juno's interaction budgets sit well under it. Apple's 120 Hz guidance is in [WWDC21 session 10147](https://developer.apple.com/videos/play/wwdc2021/10147/).

## 2. Electron

### 2.1 Startup

Order of work at launch, in parallel where the arrows allow:

1. Main: `app.enableSandbox()`, set `userData`, read a tiny `launch.json` (theme, accent, sidebar width and hidden state, window bounds) synchronously. Build the application menu before `ready` ([Electron performance tutorial](https://www.electronjs.org/docs/latest/tutorial/performance)).
2. Main: fork the engine (`utilityProcess.fork` with `serviceName: 'juno-engine'` so it is named in metrics) and create the window in the same tick. Do not wait for one to start the other.
3. Window: `show: false`, `backgroundColor` set to the token background of the saved theme (dark users must never see a light flash), `show()` on `ready-to-show` ([BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)). `ready-to-show` fires after the first paint, so the shell must paint with no data: the `App` renders the sidebar bar, filters, tab strip and an empty list before any atom resolves.
4. Renderer: request the port, subscribe `topics.list` for the default filter. The engine opens the databases and answers from `cache.db` before it opens the socket or calls Slack. Boot network work starts after the first sidebar snapshot has been sent.
5. Everything else is deferred: AI jobs, notification pipeline, digest scheduler, emoji table, and in the renderer the lazy page chunks and icon sets. Renderer deferral uses `requestIdleCallback`; engine deferral waits for the first snapshot and then yields between steps.

Rules:

- **V8 code cache on `juno://`.** Register the scheme with `codeCache: true` as well as `standard` and `secure`; the code cache only covers `http(s)` otherwise and `codeCache` requires `standard` ([custom scheme privileges](https://www.electronjs.org/docs/latest/api/structures/custom-scheme)). Set `webPreferences.v8CacheOptions: 'bypassHeatCheck'` so the main bundle is cached on the first run ([web preferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)). Measure warm start before and after; keep it if it helps.
- **No synchronous IPC.** `ipcRenderer.sendSync` blocks the renderer until main answers ([ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer)); `bun run lint` fails on it (`scripts/check-deps.mjs`). `@electron/remote` is not used. Main never does work that could block the UI thread: no sync file reads after `ready`, no JSON of any size, no `net` waits.
- **One bundle per process, workspace packages bundled.** No `require` at runtime in the renderer. Pages other than the sidebar and topic view (`Settings`, `Juno`, `All topics`) are `React.lazy` chunks, prefetched on idle after the sidebar paints. A prefetched chunk's components come from `chunk()` (`containers/chunks.ts`), not a bare `lazy`: a bare `lazy` suspends on its first render even when its chunk is loaded, and React then holds the content back for its 300 ms fallback throttle (section 8.5).
- **Fonts.** Bundled, never from a URL. The two Latin files (Figtree variable, Instrument Serif) are `<link rel="preload" as="font">` in `index.html` (added at build by `juno:preload-fonts` in `electron.vite.config.ts`, which fails the build if a file is missing; before 10-15 there was no preload, so the first layout requested Figtree and its arrival laid the page out again) so they are ready before the first content paint; other subsets load on demand. `@font-face` uses `font-display: swap` plus a `size-adjust`/`ascent-override` fallback face built from the system font so a swap never moves text ([font-display](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display), [size-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust)). The e2e asserts `document.fonts.check` for both faces before the first rows.
- **Background throttling stays on** (default `true`). Timers and `requestAnimationFrame` in a hidden window slow to 1 Hz, which is what we want: the engine owns the clock and the network, and port messages are still delivered. Nothing in the renderer may rely on a timer firing while hidden. Do not call `setBackgroundThrottling(false)`; it affects the whole window ([webContents](https://www.electronjs.org/docs/latest/api/web-contents)).
- **Process count is fixed**: main, one renderer, the engine, Chromium's GPU and network helpers. No second window, no `webview`, no `BrowserView` for a feature. Every process costs tens of MB and a startup.

### 2.2 IPC and the port

- A live query message is a plain JSON-shaped object: no `Date`, `Map`, class instances or `undefined` holes. Structured clone cost grows with object count, not bytes, so view models are flat: `TopicRow` is one object with primitive fields and one small `preview` object, not a tree.
- Snapshots cover a window (architecture 2.6), never a history. The sidebar window is 300 rows; the message window starts at 100 and grows to 500. A message that exceeds the size budget in section 1 is a bug in the query, not a reason to raise the budget.
- Deltas carry only rows whose `rev` changed. The engine diffs against the last snapshot it sent on that subscription.
- Pasted file bytes go over the port in chunks of at most 1 MB. `ArrayBuffer` transfer is not available on `MessagePortMain`; buffers are copied ([MessagePortMain](https://www.electronjs.org/docs/latest/api/message-port-main)).
- The preload stays a few hundred bytes. It asks main for the engine port as the page starts and hands it over when the page asks, forwards later ports, and exposes the small `window.juno` surface, nothing else.
- Start order in the renderer (`main.tsx`): the sidebar's list is read before the first render, so its request goes out as soon as the engine says it is ready on the port; the shell commits synchronously in the same task, before the page can paint. Waiting for the first request or a 50 ms timer let Electron show an empty window before React mounted. A topic open asks for its messages with its header (`whenReady` in `navigation.ts`), not after it.

### 2.3 Rendering and compositing

- Only `transform` and `opacity` are animated. They run on the compositor; everything else forces style, layout or paint on the main thread. Button hover and press colours are instant CSS; buttons never scale or translate on press.
- `will-change` is set on an element only for the duration of its animation (menus, toasts, popovers while entering) and removed after. Never on rows, lists or the app shell: each promoted layer costs GPU memory and compositing time.
- The one standing exception is a text field drawn inside a large layer with blurred shadows. GPU raster redraws whole tiles, so a keystroke in the ⌘K field redrew tiles of the window-sized overlay with the panel's shadow blurs: 21.6 ms of GPU raster over 40 keys against 8.0 ms in the composer (10-15, `JUNO_TRACE_SKIA`). The field's row has `will-change: transform`, so a keystroke redraws a 1116 × 100 px layer; the overlay redraws only when the results change.
- No `backdrop-filter`, no large blurred `box-shadow` on anything that scrolls. Shadows live on floating surfaces (menus, popovers, toasts, the header islands). The header's band over the message list is a static gradient, never a blur.
- Rows and messages set `contain: content` (`layout paint`) so a change inside one cannot cause layout outside it. Scroll containers set `overflow-anchor: auto` (the default) and `scrollbar-gutter: stable` ([scrollbar-gutter](https://developer.mozilla.org/en-US/docs/Web/CSS/scrollbar-gutter)).
- No layout reads in render or in event handlers that also write. `getBoundingClientRect`, `offsetHeight`, `scrollTop` reads happen in one `requestAnimationFrame` callback before any write in that frame ([avoid layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)). `ResizeObserver` callbacks only record sizes; they never write styles synchronously.
- `text-wrap: pretty` is allowed on row previews and message bodies (the spec asks for it) but not on anything that re-lays out on every frame.
- Hover styles exist only inside `@media (hover: hover)`, and never require a React render: a row that re-renders on `mouseenter` is a bug.

### 2.4 macOS feel

- Rows, tabs and nav items activate on `pointerdown` (section 4.1). Mutating buttons (Resolve, Send, Pin) activate on `click`, like native buttons, so a press can be cancelled by dragging off.
- Native context menus and the application menu (`shell.contextMenu.popup`, `Menu`) run outside the renderer; nothing in the page blocks while they are open.
- Programmatic scrolling is instant (`behavior: 'instant'`), never `smooth`, except the spec's "jump to bottom" which may animate under 150 ms and respects reduced motion.
- `overscroll-behavior: contain` on every popover, menu and the palette so the page never scrolls behind them. Try `webPreferences.scrollBounce: true` in M4 (default `false`); keep it if it costs nothing in the scroll scenario.
- Theme switching suppresses transitions for one frame, as the spec says, so colours change at once.

## 3. Virtualization

### 3.1 Decision

Two techniques, one library:

- **The sidebar topic list and the message list use `content-visibility: auto` on in-flow rows, with the engine as the virtualizer**: the live query windows the data (300 topic rows; 100 to 500 message rows) and the DOM holds exactly that window. No JavaScript runs on scroll.
- **`@tanstack/react-virtual` is the one virtualization library in the repo.** It is used for unbounded flat lists where find-in-page and cross-row selection matter less: All topics (5 k rows), Browse channels and people, and the escalation path for the message list if the measurement in 3.4 fails.

Why `content-visibility` first. Rows stay in the DOM and in flow, so Chromium's own scroll anchoring handles prepends and reorders, ⌘F finds text in every loaded row, text selection runs across rows, the accessibility tree is complete, keyboard focus moves with plain `tabindex`, and `position: sticky` gives the Pinned and Recent headers for free. Chromium skips style, layout and paint for rows outside the viewport and remembers their last size with `contain-intrinsic-size: auto <estimate>`, so the scrollbar stays stable (the estimate sizes the content box, so it excludes the row's padding: `--row-topic-estimate` is 66px for an 88px row, `--row-topic-two-line-estimate` 42px for a 64px Main row; a sidebar row’s minimum height comes from its kind; a wrapped title adds its second line); Google measured a 7× rendering win on long pages ([web.dev/content-visibility](https://web.dev/articles/content-visibility), [contain-intrinsic-size](https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size)). The cost is bounded by the window: 500 messages at about 40 nodes each is 20 k nodes, which Chromium handles without trouble as long as off-screen rows are not rendered.

Why TanStack Virtual over the others (versions as of 2026-10-12). `@tanstack/react-virtual` 3.14 is headless (we own the DOM, ARIA and StyleX), 8 kB, and has what a chat list needs: `anchorTo: 'end'` with `followOnAppend` for stick-to-bottom and prepend-stable content, `measureElement` with a ResizeObserver for dynamic heights, `getItemKey` for stable keys across prepends, and `rangeExtractor` for sticky headers ([Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)). `react-virtuoso` 4.18 ([virtuoso.dev](https://virtuoso.dev/)) has the nicest chat API (`followOutput`, `firstItemIndex`) and in-flow rows, but is 19 kB, measured slower on dynamic measurement in TanStack's benchmark, and documents that margins and late images break its measurement. `virtua` 0.53 ([github.com/inokawa/virtua](https://github.com/inokawa/virtua)) is small and has a `shift` prop for prepends but no stick-to-bottom and experimental sticky headers. `react-window` 2 has neither reverse lists nor prepends. None of them emit ARIA, so we would write it anyway. Every one of them loses unmounted rows for ⌘F and selection, which is the reason the message list does not start on a virtualizer.

### 3.2 Rules for the sidebar list

- During a sync cycle (boot, catch-up, sweep), existing sidebar rows retain their order and newly discovered rows append, so history the warm boot brings from before the launch does not shuffle the painted list. A row whose activity changed from or to a time after the engine's start (a socket message, the user's own send, or that send deleted, refused or retried) takes its place by recency at once, whatever cycle is running: cycles last many seconds and come every few minutes, and live reorders waited for them (fixed 10-27). When the cycle ends, rows it kept out of order take their true order, sliding as any change from elsewhere does. Raising the quiet window also appends the rows it brings, and they stay last until the list next changes, even when raising started a cycle.
- While the pointer or keyboard focus is in the list, it holds its order (SPEC 5). `sidebarListAtom` then keeps the shown order and takes each row's object from the live window (`holdOrder`): one pass over the 300-row window per delta, as `carryOver` already makes, and a row whose object is unchanged does not re-render. A row whose section changed while held gets one cached copy, so it is not a new object on every delta. The pointer and focus are tracked by handlers on the list, not on rows; the pointer move handler only reads a flag. When nothing holds, the atom returns the live window unchanged.
- Rows are keyed by topic id. React moves DOM nodes on reorder; the browser's scroll anchoring keeps the viewport stable when the user is scrolled down. At `scrollTop === 0` new activity pushes rows down, which is the WhatsApp behaviour the spec wants.
- At `scrollTop === 0` a change from elsewhere slides the rows to their new places (SPEC 5, "Letting go"; `ReorderMotion` in `@juno/ui`). Only `transform` and `opacity` animate, as Web Animations on the compositor: no layout, style or script runs per frame. Per change: one read of the drawn tops of the rows within the view and 320 px below it (`getBoundingClientRect`, before React writes the change), one read of their new tops after it, then the animations start; a change before the motion has settled cancels and restarts them from where they are drawn. A change that only adds rows at the end of the last section reads no row geometry; growing Pinned still moves Recent. Scrolled down, nothing animates, so scroll anchoring never sees a transformed row. The observer and player (3.7 KB) and the pure state rule (0.2 KB) load on idle after the first rows. Hidden documents and hidden scrollers skip geometry reads; hiding the window cancels current motion. Finished and interrupted animations are cancelled and released. Command writes and the first acknowledgement of a locally recorded send carry their cause through live-query invalidation; unrelated updates need no suppression window. A row's layout place is final in the commit, so the live update budget (write to pixels, 50 ms) measures the same work as before.
- Every row: `content-visibility: auto; contain-intrinsic-size: auto <estimate>`, with the estimate from tokens per density. There are two minimum row heights, known from the row’s kind before it renders: three lines (88px, 80 compact) for a thread and two for any Main (64px, 58 compact). With one-line titles the estimate is exact. With two-line titles, Chromium lays out each row at its actual height and remembers it through `contain-intrinsic-size: auto`; short titles keep the minimum. Rows stay in flow with native scroll anchoring, without JavaScript scroll handlers. Changing the title limit captures the first visible row before changing the CSS variable and restores its top before paint: one synchronous layout only for that preference change, since native anchoring can choose the preview inside a partly visible row instead. The All topics virtualizer measures its visible row slots with `measureElement` so wrapped titles do not overlap.
- Section headers are `position: sticky; top: 0` inside the scroll container. Sticky elements and the row that contains the keyboard focus are never skipped; Chromium renders focused content regardless.
- Hover work on a row (prefetch, size reads) runs only when the pointer moved onto it, not when the row scrolled under a still pointer (`pointerMoved` in `@juno/ui`). Otherwise every wheel step runs it inside a scroll frame (section 8).
- Keyboard: roving `tabindex` on rows (one row is `0`, the rest `-1`). The tabbable row is the one focused last, so after ArrowDown to a row Tab comes back to that row; before any focus it is the selection, then the first row. ArrowUp/Down move focus; focus moves scroll the row into view with `block: 'nearest'` and `behavior: 'instant'`.
- A new list mounts in two commits: the first 32 rows (enough to fill a tall window at the shortest row, a Main in Compact at 58px; it was 24 while every row was at least 80px), then the rest in a `startTransition` scheduled after that frame is painted. This applies to the first snapshot and to each filter change. Rows stay in flow, so the rows below arrive without moving anything on screen; the "Older topics" footer waits for the full list. Mounting all 300 rows in one commit was a single 120–350 ms frame. Measured on the 1,200-topic seed (`perf.spec.ts`, 5 warm launches, load 3.5): snapshot to rows painted went from a median of 162 ms to 27 ms, main process to rows from 591 ms to 478 ms, and the longest frame from 135 ms to 55 ms with no blocking time; a filter change went from a median of 58 ms (p95 124 ms) to 21 ms (p95 31 ms), with no frame showing an empty list.
- After the first rows paint, the list container keeps the other quick filters' lists (All, Channels, DMs with the current Unread and scope) subscribed, mounted on idle. Switching between them is then a cache hit with no wait for the engine; each costs one engine query per change to the topics.
- The window is 300 rows. The list shows "Older topics are in All topics" after the last row rather than paging. Changing the filter re-anchors the window; the old rows stay until the new snapshot arrives (section 5.3).

Sidebar motion review (2026-10-22, M1 Air, heavy lock): two runs measured live-update p95 at 21.0/20.2 ms and hover p95 at 10.0/11.7 ms; each hover run had nine samples, so p95 is its maximum. The same main commit (`7ba87652a`) measured hover at 5.7/5.0 ms. A diagnostic trace measured hover at 4.0 ms, with pointerover dispatch taking at most 0.15 ms and no samples in the motion or menu chunks. It starts after the trace recorder's 500 ms settling wait, so it does not replace the ordinary readings. No per-row listener or observer was added. Continuous-scroll p95 was 7.3/6.0 ms versus main's 6.1/6.0 ms. The first branch pair failed separate checks (a changed prefetch mark and one 60.9 ms long frame with no script entries); the diagnostic run passed at 6.1 ms with zero long frames and unchanged prefetch. All six motion feel scenarios passed across light and dark themes, including arrivals and interrupted slides. The page-visibility test supplies the visibility event because Playwright forces visible pages; it verifies cancellation and no new animation while hidden.

### 3.3 Rules for the message list

- Bottom-anchored: the container is a normal `overflow-y: auto` column; "stick to bottom" is a boolean in the container (`isAtBottom`, true when within 32 px of the end at the last `scrollend`). A scroll of the user's that reaches the end (within 1 px) holds the bottom at once, before it ends: a scrollbar thumb held at the end, or fingers resting on the trackpad, end no scroll, and until 10-22 a message that arrived then was left below the fold, the scroll ended more than 32 px from the new end, and later messages were not followed either. On a delta that appends while `isAtBottom`, scroll to the end in the same `useLayoutEffect`, before paint. When not at the bottom, show the "N new messages" affordance and leave the viewport alone.
- Holding a position: rows are laid out at their `contain-intrinsic-size` estimate until they come into view, so a position computed from estimates lands short once they grow (a long topic opened about 1,000 px short of the bottom). The rows that decide the position are laid out in full instead (`content-visibility: visible`, the `eager` rows of `MessageList`): a window's worth around the open position (the divider, a snapshot's row), including after the rest of the window is drawn, a window's worth of an older page above the row held while it goes in (drawn at their estimate, the page's rows between the top of the view and the held row would grow a frame later and move what is on screen), and always the last window's worth, where messages arrive and the bottom is held. The container sets `scrollTop` from exact sizes in a layout effect, before paint; a row that grows later is above the rows in view, where scroll anchoring absorbs it. The container keeps a pin (the bottom, or a row at an offset from the top: the divider on open, a snapshot's row on restore, the row in view during a prepend, unless the list holds the bottom when the page lands, and the message a notification, a link or a Juno source asked for, unless the list is at its bottom then) and puts it back in the layout effect of a commit that changes the rows, and, at the bottom, when the scroller's box or its column of rows changes size (the window, the composer growing, the Juno panel beside it, a row growing with no change to the window's rows: the edit box opening, a delete asking to confirm, a card laying out). That is the one `ResizeObserver` that writes. It watches the scroller and its column and writes only while the list holds the bottom; as rows grow during a scroll, its callback reads the pin and returns. It runs after layout and before paint. Until 10-22 it watched only the scroller, so the edit box opened at the bottom ended under the composer. Until 10-27 a notification for the newest message held that message's row even at the bottom, so its first reaction grew under the composer. An edit box also scrolls itself into view whole as it opens (`block: 'nearest'`), so one started just above the bottom shows its field and buttons. That scroll's `scrollend` comes before the observer in the frame, with the end already away, so a `scrollend` that finds the bottom still held, with the rows grown since a scroll last came to rest at the bottom, puts it back instead of letting it go. With the rows unchanged, the scroll was the user's: one that stops short of the end, within 32 px, stays where it stopped and holds the bottom from there, so the row under a still pointer does not move. The hold never undoes the user's scroll. It lets go instead of writing when the list moved up from where it last held it, is away from the end, and the user may be scrolling it up (`scrollingUp` in `containers/scrollInput.ts`: the wheel turned up, a touch moving or an up key in the last 100 ms, or a press on the list still held, not one on a control, whose native menu can swallow the `pointerup`): a wheel or trackpad delta is already in `scrollTop` when the observer runs, but its `scroll` event, which lets go, can come after it in the frame. With no such input the list moved through scroll anchoring and it holds: a topic with more messages than its window drops its first row as each message arrives, which lowers `scrollTop` by that row's height. From the morning to the evening of 10-22 the hold let go then too, so in any such topic a message that arrived at the bottom was left under the composer. Each write fires its own `scrollend`, also while the user's scroll goes on. If the list is already at the end (within 1 px), it holds immediately. Otherwise an own `scrollend` after release waits for 100 ms at the same position. It remembers whether that position was within 32 px before rows grew, so growth during the wait cannot leave the list unpinned. A queued scroll at the same position keeps the wait; actual movement cancels it. The timer checks the position again before holding, and hiding or unmounting the list cancels it. The user's own input (wheel, touch, pointer, key) or a scroll that ends elsewhere lets go of a held row. The bottom is let go only by a scroll up and away from the end: until 10-16 any input let go of it, so turning the wheel down at the end or clicking a message, which scroll nothing and end no scroll, left a list at its end that no longer held it, and new messages arrived out of view. The Juno chat holds its bottom the same way. `apps/desktop/e2e/stick-bottom.spec.ts` checks a thread, Main (arrivals, reactions, the edit box, a return to the end by the wheel and by a held scrollbar thumb, in a full window), a DM after a clicked notification and the Juno panel.
- Opening mounts in two commits, as the sidebar does (3.2): the first draws the rows from a window's worth above the open position to the end (`innerHeight` over the 40 px minimum row height), with a spacer at the row estimate in place of the rows above, so the scroll height and the position are already final; the rest replace the spacer in a `startTransition` after that frame is presented. Measured on the topic300 seed (`perf.spec.ts`, three runs, load 3 to 17): a prefetched open went from a median of 23.9 ms (p95 34.7 ms) to 17.2 ms (p95 19.0 to 19.3 ms), a cached open from 19.0 ms (p95 33.6 ms) to 16.5 ms (p95 18.0 to 18.5 ms); the press handler went from 8 to 14 ms to about 6 ms.
- Open position: if the topic has unread messages, the first paint already has the "N new" divider 80 px below the header band, `--header-band` + 80 from the scroller's top, since the list runs under the header (inventory §5) (`useLayoutEffect` scrolls before the frame is presented); otherwise the first paint is at the bottom. There is no visible jump.
- Prepending older pages: rows are inserted at the top in flow; Chromium's scroll anchoring keeps the visible messages fixed, except at scroll offset 0, where it does not anchor and the pin above does the same job ([overflow-anchor](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor), [CSS scroll anchoring spec](https://drafts.csswg.org/css-scroll-anchoring/)). Nothing may trigger anchoring suppression in that frame: no change to `position`, `transform`, `overflow` or `display` on the scroller or the anchor's ancestors, and no `overflow-anchor: none` anywhere in the list. Request the next page when the first row is within 1 000 px of the top, at most one request in flight.
- A row's height never depends on its place in the window. The engine decides a row's header (`groupStart`) from the message before it, reading one row past the window's oldest for the first row, and only the topic's first message sits flush (no top margin). Before this, the window's first row always had a header and no margin, so an older page arriving above it took both away and moved everything below it by about 20 px.
- In the Juno chat, the space between bubbles comes only from their group (2 px inside a group; the 18 px line slot and 8 px after its last bubble), and a group never depends on the read mark. Until 10-17 the agent ended a group at the unread boundary, where its "New" divider goes, while the chat shows only the divider that was there when it opened. Each bubble read partway into an answer moved the boundary, so a 26 px gap opened in the middle of the answer and closed again once the next bubble was read, moving the bubbles below it. The agent now groups across the divider, and the chat ends the group only at the divider it shows (`endGroupsAtDividers`). Off-screen bubble rows stay at their 38 px estimate: a row in view is laid out in full, so the estimate never shows as space between bubbles (the `juno-long-chat-scroll` feel scenario checks every frame, scrolling up through rows at their estimate).
- Rows are a whole number of pixels tall. A row laid out for the first time above the view grows from the 56 px estimate, and scroll anchoring moves `scrollTop` by the difference, but `scrollTop` lands on device pixels. With text at 23.2 px a line, the difference was fractional, so the rows in view were left up to a quarter pixel off and their text jumped a device pixel for a frame (the feel suite's long-thread flicker). The message's content box rounds its height up to a whole pixel (`height: calc-size(auto, round(up, size, 1px))`), so this holds for any content; `apps/gallery/behaviour.spec.ts` checks every message row in the gallery.
- Window cap: 500 rows. Beyond it, the end furthest from the viewport is dropped from the subscription window. Dropping rows at the bottom clears `isAtBottom`; "Jump to bottom" re-anchors the window at the end and scrolls there.
- Partial message caches carry `meta.windowCovered` from the message query. An isolated socket or search result does not establish the initial scroll position. A thread counts as covered only by replies stored in full: a reply a search match stored (`messages.partial`) has no reactions or files yet, so a window painted from it grew when the open's replies page landed (fixed 10-17, section 8.6). The header and empty body still paint within the 50 ms uncached budget; a Main list waits for history coverage around the read pointer or the fetch outcome. A thread window that stops at replies the store cannot prove above its first row (`meta.gapBefore`) paints at once, at its bottom with its rows at the foot of the list (`useFromBottom`), so the replies the open brings land above them without moving their text; a peek waits for its fetch only when that fetch reads the thread back to its root (500 replies or fewer), since a peek is as tall as its rows. A thread of 500 replies or fewer that no replies page proves any stretch of (stored before ranges, or known only from Slack's thread list) paints what the store holds as a stand-in (`meta.standIn`): the replies Slack's thread list vouched for, or every stored reply when as many are stored as the root counts, or its newest stored reply alone when only replies above it can come in. Its first open lands every page it reads in one transaction, so the stand-in turns into the proven window in one step. A root alone, a stand-in that stops before a newer reply, which would land below it, and a longer thread (its first open reads from the read pointer only) wait for the fetch. A window that does not reach back to the read pointer waits for the fetch too, since the topic opens at its divider. In 0.1.21 a thread window with `gapBefore` waited for the open's fetch, in a tab and in a peek, and a thread no page proved showed nothing until the open's pages reached its newest reply, which made every reopen of a thread over 500 replies, and every open of a thread stored before ranges, wait for Slack (a 600-reply reopen took one call, a median 166 ms at 150 ms per call on the M1 Air, 14 ms after the fix; a thread known only from Slack's thread list took four calls). The tab also treated the fetch as done before its rows reached the window, so a window shown on `done` painted what it held and then the rows the fetch brought; `useTopicFetch` now settles on the window's next answer, as the peek does. Offline fetches expose the available cache. The divider keeps its eager rows after the deferred rows mount.
- Messages reserve space only for content they already have (SPEC 7, "Stable geometry"): images and files of known size, and reactions or a thread link the row lists, whose chips and link are a fixed height before their images load. Nothing is held for a reaction, thread link or name that might arrive. From 10-15 to 10-16 every row held a reaction line and, in Main, a thread-link line, and every name a 128px slot; on real data that was 60px or more of empty space under each message and a time far from its name. A first chip or link grows its row at the bottom: rows above the view are absorbed by scroll anchoring, and at the bottom the stick-to-bottom effect holds the end before paint. A name that resolves late moves the time along its line. `apps/gallery/message-geometry.spec.ts` checks that rows hold no empty space, that senders sit the group gap apart and runs touch, and that the time follows the name. The Threads counter reserves its button width.
- Late-loading images never change layout: every image box gets `aspect-ratio` and a max size from Slack's `thumb_w`/`thumb_h` (or `original_w`/`original_h`) before the bytes arrive. A file with no dimensions renders as a fixed-height card. The catch-up card and the grouping suggestion arrive after the first paint; they insert above the anchor and scroll anchoring absorbs them, but they must still have no entering animation that changes height.
- Messages set `content-visibility: auto; contain-intrinsic-size: auto 56px` and `contain: content`. Text is selectable (`user-select: text` on bodies, `none` on chrome). Because rows stay in flow, selection and ⌘F behave like a normal page for the whole window.
- Rows have no hover controls: the pointer over a row changes its background and nothing else, so no handler runs on pointer moves over the list and a row's `z-index` never changes on hover. The message menu is one element for the window, drawn on demand in a portal. The delete confirm, the one control a row shows, straddles the row's top edge and paints outside the row through its `overflow-clip-margin`, so the row keeps `contain: content`; near the list's top it sits inside the row or flips below it, decided by one rect read as it shows, never again while it waits. Reactions and the selection's bar are positioned so they never force a layout of the list.
- **The message menu's morph** (More reactions turning the menu into the emoji picker) is the one surface that changes shape in motion. The rule: in the click's frame the picker mounts at its final size and place, which is the only layout; then, for 240ms, nothing lays out. Web Animations move `transform` and `opacity` on the compositor (the material and a clipping layer scaled about the pinned corner, both contents scaled back about it, a cross-fade), with the curve sampled into 24 keyframes because an inverse scale is not linear in time. The one part on the main thread is the material's corner radius and shadow, scaled back so they keep their size: a style change and the repaint of one rounded box a frame, no layout. Measured in the gallery (M-series Mac, 120 Hz, 10-22), three traces, right edge and bottom, light and dark: the click's task 22.5 to 24.0 ms (the picker's first render), then one 0.14 to 0.28 ms layout in the next frame (the picker's virtualised rows), and per frame after it about 0.06 ms of style and 0.07 to 0.12 ms of paint, a median of 0.53 to 0.59 ms of main-thread work in each 8.3 ms frame and at most 1.7 to 3.5 ms, with one run showing a single 14 ms task at 45 ms (not repeated in the other two; its cause was not traced). Reduced motion shows the picker at once, and so does R on a focused message, which opens the menu as the picker.
- First open in a second app (`perf.spec.ts`, M-series Mac, 10-22): the message menu, from the right-click's release to its grid painted, 13.4 to 14.6 ms; More reactions, from its press to the picker's emoji painted, 14.6 ms once it opened on the press (81.8 ms when it waited for the click, over the 50 ms budget).
- Sticky date separators, if added, use `position: sticky` like the sidebar headers.

### 3.4 Measurement gate and the escalation

The M4 benchmark opens a cached topic with 300 messages (20 % with image attachments, 10 % with code blocks) and asserts: first paint in 50 ms, scroll scenario within the frame budget, and prepending a 100-row page with zero visible shift (the anchor message's `getBoundingClientRect().top` unchanged after the commit). If the open or the scroll budget fails on the reference Mac after per-row memoization is confirmed working, the message list moves to `@tanstack/react-virtual` with these rules: `anchorTo: 'end'`, `followOnAppend` tied to `isAtBottom`, `getItemKey` = message key, `measureElement` with `useAnimationFrameWithResizeObserver`, `scrollToIndex(dividerIndex, { align: 'start' })` with an 80 px scroll margin for the open position, rows rendered in DOM order with `aria-setsize` and `aria-posinset`, and an overscan of 8 rows so selection drags across a screen's worth of neighbours. ⌘F then covers only mounted rows; Juno's own search covers the rest.

### 3.5 Rules for TanStack lists (All topics, Browse)

- Fixed estimate per row style, `measureElement` on, `getItemKey` by id, overscan 6.
- The scroll container is the only element with `overflow`; rows are absolutely positioned with `translateY`, so `overflow-anchor` does not apply and the list must not accept prepends. These lists only append (paging) or replace (filter).
- Keyboard: the active index is state; `scrollToIndex(active, { align: 'auto' })` on change. Rows carry `role="row"`-style ARIA with `aria-rowindex` because the DOM does not hold them all.
- All topics: rows have a 52px minimum and visible slots are measured, so two-line titles can grow without overlaps. The engine sends a window of 200 rows at an offset and the length of the whole list; rows outside the window draw as placeholders with the row's geometry. The window moves, on 50-row steps, when the rows on screen come within 40 rows of its edge, so at 2 000 px/s it moves before the placeholders reach the screen. The filters and the window move hold the old window until the new one arrives (5.3).

## 4. Interaction

### 4.1 Activate on pointerdown

Navigation (sidebar rows, tabs, nav items, filter chips, ⌘K rows, Browse rows, thread links) runs on `pointerdown`, not `click`. The press and the open are the same frame. Rules:

- Only `button === 0`, `pointerType !== 'touch'` is irrelevant on macOS but the handler checks `isPrimary`.
- `ctrlKey` on macOS is a context-menu click: ignore it. Button 2 and the context-menu key open the menu, never navigate.
- `metaKey` opens in a new tab on `pointerdown` too; `shiftKey` and `altKey` do nothing in v1 (reserved).
- The target must not be inside a nested control (`closest('button, a, input, [data-no-activate]')`), so the tab close button, links and rename inputs are not swallowed.
- Rows are not draggable, so there is nothing to cancel. Tabs are: as in Safari, a tab activates on mousedown and still drags once the pointer has moved 4px. The drag reads the tabs' places once, then writes only `transform` on the moved tabs once per animation frame, so no tab re-renders and nothing lays out while the pointer moves; the order commits once, on drop (inventory 4, "Reorder").
- `onClick` still exists for assistive technology, which synthesises `click` with `detail === 0`. A real click (`detail !== 0`) is ignored because `pointerdown` already activated; a touch press waits for its click. This is `activateHandlers` in `packages/ui/src/internal/activate.ts`.
- Keyboard activation is on `keydown` of Enter or Space (Space on `keyup` for `role="button"`, to match native buttons, but navigation rows use `keydown` for Enter). A held key's auto-repeat (`event.repeat`) does not activate again.

Menu and popover buttons use `menuTriggerHandlers` in `@juno/ui`: primary mouse `pointerdown` opens or toggles them, ignoring ctrl-click and the following mouse click. Enter, Space, ↓, assistive clicks and touch clicks still work. Preventing the mouse-down default keeps focus inside the newly opened panel. Custom popovers do not select an item on the opening press's release; native menus keep the system's drag selection.

### 4.2 Prefetch

- Pointer enter, focus, or keyboard selection of a sidebar row or a ⌘K result mounts that topic's `messagesAtom` through the atom registry (`useAtomMount` or a registry `mount` from the container) with `Atom.setIdleTTL(30 s)`. The engine runs the window query and keeps the subscription warm; the open becomes a cache hit and paints in one frame. No Slack call is made by a prefetch; the replies fetch starts on the real open.
- Pointer enter or focus on the sidebar's Home button warms `home.view` the same way (`prefetchHome`). Without it, an open after the 30 s idle TTL waits for a new subscription's first value with the topic on screen, a painted frame in between ("Home open after idle", section 8).
- At most 3 prefetched entries (topics, Home) are kept warm (LRU). The active tab's topic is never evicted.
- The Search tab warms the results before and after the selection and the hovered one, as its reader reads them: the topic's header, the window around the match and its "2 of 5" (`prefetchSearchResult`), one entry each.
- Home's picture (SPEC 12, "A picture") adds to Home's open one local-storage read and a small WebP (under 60 KB) read from disk through `juno://pictures/`, decoded off the main thread (`decoding="async"`) in a box whose size is fixed before it loads, so a late decode moves nothing. Picking and downloading the next picture, and the catalog with its stories, are lazy chunks loaded when idle after Home paints; the engine downloads at most two files at a time. Home never waits for the network: a picture not on disk is not shown.
- After the sidebar first paints, prefetch the lazy page chunks and the first topic in the list on idle.
- Prefetch work in the engine runs on the interactive lane's query path but must yield to a real open: a real subscription is served before any prefetch subscription in the same tick.

### 4.3 Tabs stay mounted

- The active tab and the 4 most recently active topic tabs render inside `<Activity mode="visible" | "hidden">` ([React Activity](https://react.dev/reference/react/Activity), stable in React 19.2; this repo has 19.3). Hidden tabs keep their DOM, scroll position and composer text; React destroys their effects, so their live subscriptions end and the engine stops working for them. Switching is a `display` toggle: one frame.
- `messagesAtom` has a 30 s idle TTL so a hidden tab's query is not torn down and rebuilt during a quick switch away and back.
- Tabs beyond the 5 are unmounted and keep a `ScrollSnapshot { anchorKey, offset }` (`scrollSnapshotAtom(topicView(topicId, tabId))` in `@juno/state`, recorded on each `scrollend`; kept per topic per tab, so Back and ⌘⇧T come back to where the topic was left in that tab, and two tabs on one topic keep their own). Switching back waits until the topic's header and window are local, as an open does, and the container restores the snapshot in `useLayoutEffect` before paint.
- Every component under a tab must clean up its effects correctly; hidden means "as if unmounted". StrictMode in dev double-invokes mounts to catch this.
- Page tabs (Home, All topics, Juno, each Juno page, Settings) follow the same rule. A place open in several tabs costs one mounted tree per mounted tab; the live queries under them are shared by payload (`liveQuery` memoizes per payload), so two tabs on one topic with the same window run one query, and two windows run two.

### 4.4 Feedback timing

- Local commands (resolve, pin, mark read, send) return in under 10 ms in the engine and the live query repaints under 50 ms, so the UI never needs an optimistic copy. Pressed state is `:active` CSS, so the press itself is instant.
- No spinner under 300 ms. Anything that can take longer uses a `delay={300}` indicator; a plain text line ("Loading older messages") is preferred to a spinner, and a global spinner never exists.
- Skeletons only where the geometry is known and the content is genuinely unknown (a never-synced topic). A skeleton must have the final height of what it replaces; otherwise show nothing.
- Content that arrives late never moves what the user is reading. Reserve space (images, avatars, cards), insert above the viewport under scroll anchoring, or add below the fold.
- The theme switch, tab switch and filter change show the finished state in one frame, never an intermediate empty state. Use `startTransition` so the old content stays until the new one is ready.

### 4.5 Scroll restoration

- Each tab records `{ anchorKey, offset }` on `scrollend` and immediately before leaving the tab. Record the first row whose top is in view, or the row spanning the view if it is taller. Restore that row's offset in a layout effect before the first paint.
- A scroll that ends away from the bottom holds that row. If its content is still at its size estimate, lay out the surrounding window of rows in a synchronous `scrollend` commit and restore the pin before paint. Drawing only the landing row lets nearby height changes move it later. Rows already laid out only get the pin.
- Window resize keeps the anchor row in place (Chromium's anchoring does this for in-flow lists).
- Sidebar scroll position survives filter changes only when the filter result contains the anchor row; otherwise the list starts at the top.

## 5. React and state

### 5.1 Granularity

- The list container subscribes to `order: Id[]` only. Each row subscribes to its own `Atom.family` member derived from the live query's row cache (`sidebarRowAtom(id)` in the sidebar). A delta that touches one row re-renders one row.
- Rows and messages are `React.memo`. Props are primitives or identity-stable objects from the `rev` cache. Callbacks take the id as an argument (`onOpen(id)`) and are created once in the container, so no row receives a new function on each render.
- Time is a leaf: `RelativeTime` subscribes to `nowAtom` and formats a `ts` prop. Rows pass `ts` and never read `nowAtom`, so the minute tick re-renders only the visible time labels.
- Context providers that change often (theme, now, tabs) sit as low as possible; nothing above a list may change on a tick.

### 5.2 Deltas and identity

- The client keeps `Map<Id, Row>` per subscription. A delta applies `upsert` by id; rows with an unchanged `rev` keep their object. `order` is compared element-wise and the old array is kept when equal, so the container does not re-render for a delta that only edits rows.
- Schema decoding runs on the delta's `upsert` rows only; rows not in the delta are never re-decoded. The cache lives in `@juno/state`, in one place.
- `Atom.withEquality` guards every derived atom that produces an object, so a recompute that yields an equal value does not notify.

### 5.3 Transitions

- ⌘K: the input is local state; `useDeferredValue(query)` feeds `searchAtom`, and results render inside the deferred value so typing is never blocked ([useDeferredValue](https://react.dev/reference/react/useDeferredValue)). The local FTS query has no debounce; the command reading (`readCommand`) waits for a 150 ms pause while the dedicated Search session waits 400 ms before Slack search, and each renders when it arrives without delaying or moving the local rows. Each tab keeps the last rendered answer, including "No matches." and any command rows, until the next local answer arrives; All waits for both of its local answers, so its groups paint together. Loading belongs to the current input; an empty state belongs to the displayed answer. Clearing selects the warm empty-query state immediately.
- Tab switches and theme changes are wrapped in `startTransition` ([startTransition](https://react.dev/reference/react/startTransition)) so React keeps the old UI until the new one is ready.
- A transition does not hold atom state. `useAtomValue` is a `useSyncExternalStore` subscription, and React commits those updates synchronously even inside `startTransition`, so a list whose source atom changes (a new filter's live query starts as `Initial`) renders empty until the data arrives. The atom must hold the previous value itself. The sidebar does this in `sidebarListAtom` (`@juno/state`): it keeps the window shown until the new filter's first snapshot arrives, then replaces it in one update, and rows whose `rev` is unchanged keep their objects, so only the rows that enter, leave or differ re-render. Any other list that switches its source (All topics filters, the message window on topic switch) follows the same pattern.
- Large commits (a 100-row prepend) are plain updates, not transitions: they must land in the same frame as the scroll adjustment.

### 5.4 Compiler and memo

- The React Compiler ([react.dev/learn/react-compiler](https://react.dev/learn/react-compiler)) runs through Oxc's Rust port, `oxc-transform-react` (pinned exactly), from `@vitejs/plugin-react`'s `compiler` option. `reactWithCompiler` in `apps/desktop/renderer.vite.ts` sets it up for the app's renderer, the web shell, the DOM lane's bundle and `apps/gallery/vite.config.ts`, and it compiles the workspace packages' source too. There is no Babel pass. The port follows React's experimental compiler build, not 1.0; on 10-26 its output matched that build on 1,472 of 1,496 files. It removes most hand-written `useMemo`/`useCallback`. Explicit `React.memo` stays on rows and messages so the rule is visible and survives a compiler bail-out. The build prints a `[plugin vite:react-compiler]` warning, with the code and the reason, for each component or hook the compiler leaves as written; read those lines after touching a component. It leaves as written any component or hook that holds an `eslint-disable` or `oxlint-disable` of a `react-hooks` rule; that is deliberate, and is the compiler's default. The compiler takes a module-level variable for a constant inside a component or hook, and may read it again where a local copy was taken: read and change a module `let` through a plain function, not inline in a component or hook (`takeMeasure` in `containers/search/Reader.tsx`, whose inline copy made `juno.search-reader` run from the page's start). To confirm it ran, a compiled module imports `c` from `react/compiler-runtime` and calls it once per compiled component or hook (`_c(n)` in an unminified build). Still skipped (10-26): hooks under a `react-hooks` disable in `TopicComposer`, `messageCommands`, `position`, `rowAccessories`, `chatScroll`, `WebPanel`, `SearchTab`, `Reader`, `search/list`, `SearchResults`, `ReactionsDialog`, `reactorsPopover`, `Gallery` and `menuMorph`; `EmojiPicker` and `AllTopics` (`useVirtualizer` is an incompatible library); `MediaViewer` and `search/field` (expressions the compiler cannot yet reorder); `huddle/Tab` (unreachable code) and `emojiSuggestions` (dynamic `import()`).
- Any component whose render exceeds 1 ms in the React profiler for a single row is split or memoized.

### 5.5 StyleX and CSS

- StyleX has no runtime cost: `stylex.props` concatenates precomputed class names. Dynamic styles (`stylex.create` with a function) write inline CSS variables and are fine for a handful of values (avatar colour) but are not used for per-frame values.
- CSS size is the only StyleX cost. The budget is 200 KB, minified (`lightningcssOptions: { minify: true }` in `apps/desktop/renderer.vite.ts`); new variants are measured.
- Hover, press, focus and selection states are CSS pseudo-classes, never React state.

## 6. Engine

- **Indexes.** Every live query has a test that runs `EXPLAIN QUERY PLAN` against the large fixture and fails on `SCAN` of `messages`, `topic_index`, `reactions` or `topic_overlay`. Required at minimum: `topic_index(last_activity_ts DESC)`, `topic_index(channel, last_activity_ts DESC)`, `messages(channel, thread_ts, ts)`, `messages(channel, ts)` (the primary key), `reactions(channel, ts)`, `topic_reads(topic_id)`, `outbox(target_key, created_at)`, `notification_log(at)`. `messages_fts` uses `prefix='2 3'` for the palette.
- **Windows.** A query takes an anchor and a count and returns at most the window. A query that can return unbounded rows is rejected in review. All topics has to sort and count the whole index, so its order statement reads every topic of every member conversation through the channel index and returns only the window's ids and the length; the rows are then read by primary key. Its query time is in the engine benchmark (`allTopics.list on the large seed`).
- **Deltas.** The engine keeps the last emitted `{ order, revById }` per subscription and sends only rows whose `rev` changed plus the new `order` when it differs. A run that changes nothing sends nothing, and a value equal to the last one is not sent again.
- **Reuse between runs.** A list query whose rows are expensive to shape keeps what it built for its subscription and rebuilds only rows whose inputs changed. The sidebar query (`engine/src/topics/query.ts`, `RowCache`) reuses each topic and row object while the joined columns and the people are unchanged, and keeps the users it has read until the `users` table is invalidated. On the large seed this takes a re-run from about 6 ms to about 2.5 ms; the SQL is about 1 ms of it. The message window (`engine/src/messages/query.ts`, `MessageCache`) does the same per message: a message whose version, reactions, group start and thread link hold keeps its row, and a body is parsed again only when it changed or a name it uses did; on a 300-message window a re-run is about 1 ms and a first run about 4 ms.
- **Re-index only what changed.** `reindexTopics` runs at the end of every page, event and command for the topics they touched, but a topic none of whose inputs changed since its row was computed stops after reading its read state and its mark (`topic_inputs`, architecture 4.2; `sync/src/topicInputs.ts`). Writers keep marks by not writing what did not change: `writeMessage` skips an unchanged message, and a thread range whose tail only moves between `live` and `held` is updated in place. A write that changes nothing the index reads must not clear a mark, or every start computes those topics again (8.15).
- **Batching.** One writer transaction per socket event or command, wrapped in `Reactivity.withBatch`, so dependent queries re-run once. Invalidation keys are specific (`['messages', topicId]`, `['topics']`), never a global key. Backfill pages commit in 200-row transactions and `Effect.yieldNow` between them.
- **Debounce.** Leading-edge, 30 ms trailing on live query re-runs (architecture 2.6). A command's own invalidation is never delayed.
- **Sleep when idle.** A worker computes its next wake from what is due and sleeps until then or until a wake; it never re-runs on a timer of zero. The next wake comes only from rows the next pass would try: a send worker tries the first row of each channel, so a due row behind a row that waits out a backoff does not count (`channelHeads`, 8.12). A step that asks another fiber for work (a missing user, a lookup) must make that work end: ask only for what the store lacks, and never ask again from the answer's own re-run. The idle-CPU budget in section 1 checks this.
- **The event loop.** `node:sqlite` is synchronous, so statements are prepared once and small. Nothing after boot may run more than 50 ms synchronously; large JSON (a `userBoot` response) is parsed once at boot and never on the interactive path. `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `cache_size` sized for the large workspace, `busy_timeout=250`.
- **Priorities.** The `RequestQueue` orders lanes, and within the interactive lane the user's own call goes first. An open's first page and a jump to a message (`messages.loadAt`: a search match, Next and Previous in the search reader, a link, a palette jump) run as `interactive`; pages read ahead of the user (older and newer pages near a view's edge, an open's later pages, the refresh of open topics after a reconnect) run as `paging`. Paging shares the lane's three permits and its tokens, waits behind any waiting interactive call, and never takes the last free permit or the last two tokens, so the user's call starts at once however much the views read ahead. It adds no concurrency or rate: a superseded page is not dropped, it only waits. A jump asked for again while its read is out (the search reader's step and its own load of the match) joins that read rather than reading the same pages again. With Slack holding three threads' later pages, a jump into one was answered in 28 ms; before, it waited for a held page to finish (5,116 ms with the pages held 5 s), and with every call taking 400 ms it took 1,548 ms against 856 ms after, two calls' worth (`packages/engine/test/flows/fetch-order.flow.test.ts`, 10-27). The query side orders too: a subscription that belongs to the active tab or a user command runs before prefetch and background invalidations.
- **Engine timing on the wire.** Every live query message carries `meta: { queryMs, encodeMs, seq }` so the renderer can attribute the write-to-pixels budget without a cross-process trace.

## 7. Measuring

### 7.1 Instrumentation in the app

- `@juno/state/perf.ts` wraps `performance.mark` and `performance.measure` with a fixed set of names: `juno.start`, `juno.shell-paint`, `juno.sidebar-rows`, `juno.sidebar-snapshot` (a mark: the first sidebar snapshot reached the renderer), `juno.sidebar-paint` (that mark to the rows painted), `juno.topic-open`, `juno.tab-switch`, `juno.filter`, `juno.palette-open`, `juno.palette-results`, `juno.send`, `juno.live-update`, `juno.peek-open` and `juno.prefetch` (a mark: a topic was warmed, section 4.2), and for the Juno chat `juno.chat-send`, `juno.chat-bubble`, `juno.panel-open` and `juno.page-switch`. Each measure sets `detail.devtools` so it shows as a "Juno" track in the Chrome DevTools performance panel ([DevTools extensibility API](https://developer.chrome.com/docs/devtools/performance/extension)).
- A slow thread send prints three stage marks: `juno.send-checked` when the store-only checks answer, `juno.send-queued` when the queue command answers, and `juno.send-commit` when React commits the row. Each replaces its previous mark, so diagnostics do not grow with the number of sends. The gap from commit to the completed `juno.send` includes frame scheduling and presentation. A send run that loses window focus or visibility fails as contended.
- The write-to-pixels measure starts from the engine's `meta.seq` timestamp (shared clock, `nowAtom`) and ends in a `requestAnimationFrame` plus `setTimeout(0)` after the commit, an estimate of paint completion. It does not wait for compositor presentation feedback; the typing controls below measure that separately.
- That end is only right for a real click. A pointerup in the frame right after the pointerdown, which is what Playwright's `mouse.down(); mouse.up()` sends, makes Chromium defer the page's tasks (timers and `scheduler.postTask` alike) until after the next frame. In a trace the frame was drawn 16 ms after the press and the measure ended at 33 ms with the main thread idle in between, on about one press in five. The e2e driver's `press` holds the button for 60 ms, as a person does.
- A `PerformanceObserver` for `long-animation-frame` (threshold 50 ms, `blockingDuration`, `scripts[].sourceURL`) and for `event` with `durationThreshold: 16` runs always, and the counters are always on `window.__juno.perf` (`apps/desktop/src/renderer/main.tsx`), so tests and DevTools can read them in any build.
- React's Performance Tracks appear in dev builds ([React 19.2 release notes](https://react.dev/blog/2025/10/01/react-19-2)); use them to find which component owns a long frame.

#### Keystroke presentation controls

`perfTyping.ts` measures a native input, the topic composer and the palette the same way. Each `input` event makes a trace mark at `event.timeStamp`, then a mark in its first animation frame. At that callback the field must still contain the inserted characters. Rapid keys can share a frame; each input remains one sample. The parser finds the enclosing `AnimationFrame` and joins its process and `args.id` to `AnimationFrame::Presentation`. The difference between that feedback timestamp and the input mark is the sample. Missing frames or feedback fail the run; a timer never substitutes for them. The tests also check the input count, final value and window focus. Ordinary runs use timeline tracing without the CPU profiler.

Chromium emits that presentation event using `presentation_feedback.timestamp` ([source](https://chromium.googlesource.com/chromium/src/third_party/+/refs/heads/main/blink/renderer/core/frame/animation_frame_timing_monitor.cc)). A `requestAnimationFrame` followed by a timer can finish before this feedback, so using it here would hide the presentation delay. The old palette gate collected only Event Timing entries of at least 16 ms, rounded to 8 ms, included both keydown and keypress, and rejected every sample over the budget rather than testing p95. Those entries remain a diagnostic beside the complete input sample set.

**The budget is relative to a native control.** Each typing scenario also types into a bare `<input>` laid over the window, which runs no app code, and the surface's p95 must be within one refresh interval of the control's p95 in the same run (`characterBudget` in `perf.spec.ts`). The reasons:

- The floor is not ours. In 10-15 runs the bare input read 38–54 ms p95 at 60 Hz, above the old 16 ms (24.7 ms at 60 Hz) budget. Most of it is after the frame: the time from the animation frame callback to presentation is about 23 ms with no app code, one or two refresh intervals depending on where the key lands in the frame, and typing bursts land several keys in one frame. No change in Juno can go below it.
- Measured in the same run, the control moves with the machine's load and clock, so the comparison isolates what our code adds to a character.
- One refresh interval is the smallest difference the user can see: a character that is one frame late. Anything inside it is either noise or work that still fits in the frame.

The gate is weaker than an absolute number when the control is slow in a run, so the printed control p95 should be read beside it; a control far above 40 ms means the run was contended.

A diagnostic run reproduced the apparent plateau outside the palette: composer Event Timing p95 56 ms, native input and palette 48 ms. Matching the actual frames gave 52.5, 48.0 and 49.3 ms respectively (40 inputs each, profiled, not final numbers). A subsequent ordinary trace gave 39.3, 52.7 and 54.5 ms. This rules out palette work as the explanation for a fixed 56 ms reading. It does **not** establish that character presentation meets 24.7 ms: the native control also misses. The existing timer-based interaction measurements and this presentation-feedback measurement have different endpoints.

The `mention typing` scenario types "@ma " ten times in a reply, so every "@" opens the suggestions and each letter narrows them. Run beside the controls on 10-15 (60 Hz, load 5 to 6): input to its frame p95 14.0 ms against the composer's 13.6 ms, so the suggestions add no measurable main-thread work per key; input to character presented median 38.8 ms, p95 52.9 ms, against the composer's 33.7 and 49.3 ms and a bare input's 32.0 and 37.8 ms. The extra time is between the frame and its presentation (median 36.6 ms against 22.7 ms): more of those frames wait one more refresh. Not yet explained; the list's shadow being drawn again as it narrows is the first thing to check.

The keystroke controls also type at the end of a draft of about 3,000 characters full of Slack markup (30 quote lines with bold, italic, code and strikethrough, and a 20-line code block), where the field draws its look again on each keystroke (SPEC 8, "Formatting"). On 10-20 on this Mac (60 Hz, load 2.8), one run: input to character presented p95 40.2 ms against the bare input's 39.2 ms (budget 55.9 ms) and the empty composer's 36.1 ms; frame callback p95 15.7 ms against the empty composer's 13.3 ms.

The `Juno mention typing` scenario types the same "@ma " ten times in the Juno tab's composer, which uses the same suggestions and chip layer. On 10-18 on the M1 Air (60 Hz, load 5 to 6), one run each: the Juno composer read median 31.6 ms, p95 45.4 ms against its bare input's 31.5 and 39.1 ms, inside the budget (frame callback p95 12.4 ms). The topic composer's scenario in the same run read median 29.5 ms, p95 65.2 ms against 31.1 and 38.4 ms, over its soft gate, with the excess again after the frame (callback to presentation p95 56.8 ms, frame callback p95 14.5 ms).

### 7.2 Tools

| Need | Tool |
| --- | --- |
| Frame-level trace of the renderer in a test | Playwright: `page.context().newCDPSession(page)` then `Tracing.start` with `devtools.timeline`, `disabled-by-default-devtools.timeline.frame`, `blink.user_timing`, `v8.execute`; `Tracing.end` and read `dataCollected` ([Playwright Electron](https://playwright.dev/docs/api/class-electron), [CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)). Playwright's own `context().tracing` works too but is coarser. |
| Slow the CPU to match CI | CDP `Emulation.setCPUThrottlingRate` on the renderer page. |
| Counts without a trace | CDP `Performance.getMetrics`: `JSHeapUsedSize`, `Nodes`, `LayoutCount`, `RecalcStyleCount`. |
| Trace across main, renderer and engine | `contentTracing.startRecording({ included_categories: [...] })` from main; `stopRecording` returns the file path ([contentTracing](https://www.electronjs.org/docs/latest/api/content-tracing)). |
| Memory and CPU per process | `app.getAppMetrics()` (the engine shows under its `serviceName`; `cpu` is since the last call; memory in KB) and `process.getProcessMemoryInfo()` inside a process, using `private` on macOS ([app](https://www.electronjs.org/docs/latest/api/app), [process](https://www.electronjs.org/docs/latest/api/process)). |
| Engine query timing | The `meta.queryMs` field, and the engine benchmarks in `packages/engine/test/perf/*-large.perf.ts`. |
| By hand | `bun run dev`, open DevTools, record the Performance panel while repeating the interaction 5 times. Read the Juno track, the React tracks and the LoAF entries. |

### Counted budgets

Tushar, 10-26: "count work instead of timing it ... timing is flaky anyway depends on cpu state, we can even count renders/cpu instructions whatever". Every run, the full run included, checks counted budgets: the work a main path does, counted, against a fixed number. A count does not depend on the machine, its clock or its load, so a budget is today's count with a little headroom (about 10 %, or 2 under 20) and fails only when the work grows. Timed (stopwatch) perf, section 7.3, runs on demand.

**What is counted, and where.** Each count sits in the cheapest lane that sees it.

| Lane | Counts | How | File |
| --- | --- | --- | --- |
| Engine flow (`bun test`) | SQL statements run and rows they returned, by statement text | `packages/engine/test/sqlWork.ts` wraps `node:sqlite`'s `prepare` and statement methods in the test process and counts only the statements on the databases in the engine's user-data folder, so work from another file in the same test worker is not counted | `packages/engine/test/flows/counted-work.flow.test.ts` |
| DOM lane | React commits and component renders, by component name; port requests, live messages and replies, and bytes each way, by RPC route and bridge channel | A React DevTools hook on the window (`onCommitFiberRoot`, which production React calls): a component rendered when it mounted or has React's PerformedWork flag, and subtrees React did not visit are skipped (`apps/desktop/dom/work.ts`). The page's socket counts frames (`dom/socket.ts`) | `apps/desktop/dom/counted-work.test.ts` |
| Browser lane | Layouts and style recalculations (CDP `Performance.getMetrics`: `LayoutCount`, `RecalcStyleCount`; style recalculations for typing only) and DOM mutations (a `MutationObserver`) | Chromium's own counters | `apps/desktop/e2e/counted-layout.spec.ts` |

**Why the counts hold still.** Work that runs on a timer or by chance of timing is kept out of the counted window, never averaged over:

- Engine: engine time is frozen after boot (`controlledClock`) and moves in 1 s steps, with the fake's answers and the socket's frames landing between steps, until the action's outcome shows and two steps run no SQL. Periodic work (the socket keep-alive, the title, Home and Automated ticks) is set to a day. Before the first count, sleeps started before the freeze end on live time and Automated's first pass over every conversation is run, so boot's leftovers fall in no counted step. This found that every unknown socket frame opened an empty write transaction; it no longer does. Two requests that race are ordered: the cold topic open waits for the window's first run before it asks for the open, so the fetch's write of the range it covers always runs the window a second time. The app sends them together and either can land first; the budget counts the slower order (41 statements against 32, which failed the 10-26 release run).
- DOM lane: with `domTest(..., { counted: true })` the engine's frames reach the page one at a time, each after React has nothing scheduled, so two frames never share a commit by chance. A frame of several messages, or a stream chunk of several values, reaches the page as one frame each: the engine puts the values it made while the page's acknowledgement was on its way into one chunk, so how many share one depends on timing (a live message's two sidebar deltas came as one chunk or two, 17 or 20 renders). The page's `Math.random` is seeded, and its time stands still while its timers run (`setFixedTime`): the page's clock ticks at each real minute, and a send that crossed one counted every message row again at the topic's ten-minute step (360 renders against 286, a laptop full run on 10-27). A step ends after 600 ms with no commit or frame and no request waiting for its reply, longer than the page's own delays (the draft save waits 400 ms). Bytes count every number, run of digits and UUID at one width, so a later timestamp or a new message id is not more traffic; the RPC keep-alive and stream acknowledgements are left out. Startup is a relaunch counted from the new page's first frame to rest, with the engine's catch-up done before the page opens and Slack showing the user active: the shell's activity poll runs when the engine is ready and the engine tickles Slack when the socket connects, so the step waits for the account button's dot, or that change lands in whichever step is running then (a late `notifications.status` in the reopen's bytes). A rest right after another ends at once when no count has moved since, so a step's rest before its action costs nothing after the last step's rest. The 300-conversation test quits as soon as it has signed in, and the engine finishes the first sync with no page open before the counted relaunch. Typing counts the keys until the field shows them; the debounced draft save is counted on its own, as requests.
- Browser lane: counting starts once Slack shows the user active, for the same reason (the account button's dot changed three attributes in a slow scroll step), and mutations are counted in the open topic, not in the sidebar, which sync cycles mark busy on their own schedule. The list moves by a fixed distance per step, programmatically, after a first pass over the same rows (pictures loaded, row sizes kept), and each step waits for two frames, every picture in view, an idle callback and two more frames. The scroll's style recalculations are not counted: the list's 100 ms scroll-rest timer commits before or after a frame by timing, which splits or joins a recalculation, and moving each scroll into a frame callback did not change that (25 to 28 in ten runs). A style written to every row still shows as mutations.

Measured 10-26: the engine's counts were the same in three runs (and, after the open was ordered, in 40 runs of the file beside six busy loops on this Mac) on this Mac and in laptop runs at 1, 2 and 4 cores (the same work on less CPU), on macOS and Linux alike. The DOM lane's were the same in laptop runs at 1, 2 and 4 cores, except startup's request count, which moved by one when Home's randomly picked picture had to be fetched (the seed cannot fix how many random numbers the page drew before the pick); outgoing bytes at startup are not budgeted for the same reason. In the browser lane layouts and mutations were the same in six runs; style recalculations during the scroll read 30 to 32. On 10-26, 20 runs of each counted test under load (four workers on two laptop cores) gave the same counts every time, except startup's request count as above, the large sidebar's startup commits (34 to 36, within its budget) and the scroll's style recalculations, which read 25 to 38 against a budget of 36 and are no longer counted (above). With them left out, 20 runs under load gave the same scroll and typing counts every time.

**The budgets.** Count on 10-26 (the send and the warm start on 10-27), then budget.

| Path | Engine (statements / rows) | Renderer (commits / renders; requests / messages; bytes in / out) | Layout |
| --- | --- | --- | --- |
| Startup to the first rows, at rest | Sidebar first run: 8 / 31 → 10 / 35 | 34 / 478; 42 / 42; 38,190 B in → 38 / 526; 47 / 47; 42,009 | |
| Topic open, cold | #eng's Main: 32 / 45 → 36 / 50 | 10 / 405; 12 / 13; 8,823 / 1,262 B → 12 / 446; 14 / 15; 9,706 / 1,389 | |
| Topic open again | 31 / 40 → 35 / 44 | 5 / 316; 4 / 5; 470 / 489 B → 7 / 348; 6 / 7; 517 / 538 | |
| Tab switch | | 3 / 58; 3 / 4; 492 / 507 B → 5 / 64; 5 / 6; 542 / 558 | |
| Typing 21 keys | | 42 / 105; no request → 47 / 116; 0 / 0; then one draft save | 44 layouts, 25 styles, 45 mutations → 49 / 28 / 50 |
| Send | 125 / 160 → 138 / 176 (10-27, when the queued post began to re-index its topic so the sidebar moves it before Slack answers: one re-index and one more sidebar read; 102 / 115 → 112 / 127 before, and 107 / 134 → 118 / 148 before unchanged messages were no longer rewritten) | 10 / 326; 4 / 17; 9,937 / 515 B → 11 / 359; 6 / 19; 10,931 / 567 (10-27, the sidebar row moving when the post is queued; 8 / 260; 4 / 12; 5,785 / 515 B before) | |
| A live message or reply | Message 49 / 92 → 54 / 102; reply 103 / 156 → 114 / 172 | Reply: 6 / 250; 1 / 13; 8,167 / 92 B → 8 / 275; 3 / 15; 8,984 / 102 | |
| Warm start of the default workspace, to rest (a relaunch against the fake that made the first sync, so the stored URLs keep its port) | 737 / 866 → 815 / 950 (10-27; 872 / 1,134 before topic marks, which fails it; 784 with a fake on another port) | | |
| Scrolling a message list, 12 steps of 180 px | | | 6 layouts, 1 mutation → 8 / 3 |
| Sidebar of 300 conversations | First run 8 / 348 → 10 / 383; one live message 51 / 619 → 56 / 681 | Startup 34–36 / 2,821–2,829; 43 / 43–44 → 40 / 3,112; 48 / 49; one live message 1 / 17; 0 / 4; 7,412 B → 3 / 19; 0 / 6; 8,154 | |

**What each catches.** Each was put in by hand on 10-26 and failed its budget (the patches are in `/Volumes/AgentWork/scratch/counted-perf/`):

| Regression | Failed on |
| --- | --- |
| The sidebar query reads each row's conversation with a query of its own | Large sidebar first run: 295 statements against 10; default sidebar 29 against 10 |
| The messages window counts each message's reactions with a query of its own | Topic open, cold: 41 statements against 36 |
| A message event reads the whole channel's history again | Send: 182 rows against 148 |
| Each sidebar row reads the whole list atom instead of its own row | One live message in 300 conversations: 302 renders against 19 (287 rows); tab switch 79 against 64 |
| A live list sends every row in every delta | One live message: 279,054 bytes in against 8,154; topic open 30,198 against 9,706 |
| The topic view keeps the composer's text and hands it to the message list; the draft saves on every key | Typing: 819 renders against 116 (every message rendered on each key), 21 requests against 0 |
| A scroll handler writes a style to every drawn row and reads its height | Scroll: 714 layouts against 8, 1,801 mutations against 3 |

Taking `memo` off `TopicRow` changed no count: the React Compiler already keeps each row's element, so the rows still skip. The budget counts what React does, not what the code says.

**Cost.** The engine file is three tests, about 3.5 s on this Mac. The DOM file is two tests, 9 to 14 s each on two laptop cores. The browser spec is one test of 4 to 6 s. Counting itself is a few increments per statement, commit or frame.

**Raising or lowering a budget on purpose.** A failure names the action, every count over its budget, and what the counts were made of: the statements by text with their runs and rows, the components that rendered most, the routes with their requests, messages and bytes. `JUNO_WORK_COUNTS=1` prints every count in the `bun test` lanes (`detail` adds what each was made of; `bun run remote --env JUNO_WORK_COUNTS=1 test:dom --files ...`); the browser lane prints its counts when it fails. When the work grew on purpose, set the budget to the new count plus the headroom in the same change and say why in the commit. A count well under its budget prints a line saying to lower it; lower it in the change that made the work smaller. A budget that fails on an action nobody changed points at something running by timing in its window: find it and keep it out of the window, do not widen the budget.

**Not counted.** CPU instructions: Valgrind is tens of times slower than the code it runs and Linux `perf` counters need a privileged container, and V8's `--cpu-prof` ticks are samples, not counts. V8's precise coverage gives exact function call counts, but they change with any refactor, and a test that changes with every code change gives no signal.

### 7.3 The perf harness

Timed perf runs on demand only: no full run or `--with-mac` run includes it (10-26). What every test run checks instead are the counted budgets in the fast tests (renders, queries, IPC bytes, layout work; "Counted budgets", above), which do not depend on the machine's speed. `bun run perf` runs the small set of desktop scenarios that stands in for the rest (the scenarios tagged `@proxy` in `apps/desktop/e2e/perf.spec.ts` and `*.perf.spec.ts`, below), under the exclusive heavy lock, on the laptop or the Mac. The rest run when asked for (`scripts/perf.mjs`): `bun run perf --full` runs every desktop scenario and the package budgets (the agent's and engine's `*.perf.ts` files, through `bun test`); `bun run perf --area <area>` runs one area's scenarios and package budgets; `bun run perf -g "topic view"` runs matching desktop scenarios, and `--with-unit` adds the package budgets to such a selection; `bun run perf --unit` runs only the package budgets. Normal unit and e2e runs do not assert latency budgets. Their readiness timeouts still fail hung operations, and query-count, payload and correctness assertions remain in normal runs. The remote heavy idle smoke check is the deliberate exception: it checks gross resource growth, not fine performance. A scenario that did not run fails the run (`e2e/no-skips.ts`): Playwright counts a skipped test as a pass, and in a serial group a failed setup skips every scenario after it, so a setup that broke once left topic opening, scrolling and peek unmeasured with only the setup reported.

**Two ways to check it.** The budgets in section 1 are product targets on the reference Mac. The laptop checks for regressions instead, where Electron draws to an Xvfb display in a Linux container and its numbers differ from the Mac's:

- **Laptop** (`bun run remote --cores 2 perf`, with `--full`, `--area` or `-g` as needed; about 70 s for the small set). The scenarios run on one worker, in one two-core job. Each metric of the small set is checked against `apps/desktop/e2e/perf-baseline.json`, which holds one set of metrics per runner shape (platform, threads and Electron version), by the rule in `packages/testing/src/perfRule.ts`. Load on the host only adds time, so the check reads a scenario's lower quartile (nearest rank: the fastest of 3 or 4 samples, the second of 5 to 8, a quarter of the way up a scroll's frames), which its slow samples do not move. A metric is checked only when it is steady: its lower quartile moved at most 1.3 times between the baseline's fastest and slowest runs. It fails above 1.1 times the slowest run plus a floor (1 ms, 20 MB). On 10-26, 9.5 ms of main-thread work added to every topic open's first frame (30 % of the uncached open) failed the uncached open at 39.7 ms against a ceiling of 36.8. Until 10-26 every scenario ran in each nightly full run, in two parts of two cores each (408 s in all), and before that on three workers sharing two cores, where one scenario's samples spread up to five times while another scrolled beside it. Timing a fixed CPU workload beside each metric, to scale times by the job's speed, was tried and dropped: the allocator pins the job's cores, and the workload read the same at loads of 5 and 26 while some metrics moved by up to a third with the load, each by its own amount. The small set takes fewer samples there (3 to 5 rather than 5 to 20) and sweeps the scroll once, continuously. The baseline changes only through `bun scripts/perf-baseline.mjs update <run folders>`, on request or after a change that moves a number on purpose, so a slow creep fails rather than becoming the new baseline. It is made from two runs of the small set, one on a quiet laptop and one beside a gallery walk in another job (10-26: send in Main read 37.3 and 45.3 ms, the others moved at most 1.1 times). Two runs give a looser spread than the fifteen the earlier baseline had, so a ceiling sits further above a typical reading; adding runs over time, at other loads, tightens it. Scenarios outside the set have no laptop baseline: run on demand there, each metric is printed and passes, and so are the package budgets; the Mac checks them against the absolute budgets.
- **One core is not enough** (10-26, `--cores 1`, quiet and beside a gallery walk and spec check on five other cores). Memory and the warm start held on one core (the warm start at 1.26 to 1.5 times its two-core time, four processes starting on one core). The rest did not: the reopen of #eng read 13.0 ms quiet and 28.8 ms loaded, the 300-message thread's scroll frame work 2.8 and 4.2 ms, send in Main 62 and 74 ms against 35 on two cores, and the uncached open 31.8 to 40.5 ms across four runs against 30.2 to 32.5 on two. On two cores, load on the host's other cores barely moves them, so perf runs on two.
- **One core or two** (10-26, `--cores 1`, quiet and beside a gallery walk and spec check on five other cores). Memory and the warm start hold on one core: memory reads the same as on two, and the warm start reads 1.26 to 1.5 times its two-core time (four processes start on one core) but moved 1.2 times between quiet and loaded runs, inside the steady rule. The rest do not: the reopen of #eng read 13.0 ms quiet and 28.8 ms loaded, the 300-message thread's scroll frame work 2.8 and 4.2 ms, send in Main 62 and 74 ms against 35 on two cores, and the uncached open 31.8 to 40.5 ms across four runs against 30.2 to 32.5 on two. On two cores, load on the host's other cores does not move them (the earlier baseline's fifteen runs at loads of 1 to 26), so they run there.
- **Mac, by hand** (`bun run perf`, `--full` or `--area`). Every scenario takes its full sample count and fails when its p95 (p50 where section 1 says so) is over the absolute budget; the one-frame budgets use the rule proposed in section 8 on a display slower than 120 Hz. Tushar asks for it occasionally and before a release. Only the Mac runs the frame floor, Home's opens after 31 s idle and the stepped and held-clock scroll sweeps: those answer Apple silicon's clock after idle or are diagnostics with no budget. `JUNO_PERF_ABSOLUTE=1` applies the absolute budgets anywhere.

**The small set.** A few cheap scenarios that cover the main paths stand in for every timed budget; they are what `bun run perf` runs. A new scenario joins the set (tag it `@proxy`) when a real slowdown gets through that none of these catch. The set and why:

| Scenario | Metrics | Why it stays |
| --- | --- | --- |
| Warm start on the large workspace | main process to sidebar rows | The start runs main, the renderer, the engine and the sidebar query on 1,200 topics; four launches, no warmup |
| Memory after heavy use | main, renderer and engine private memory | Growth in any process; a short use (6 topics, 12 tab switches, 6 chat messages, 6 s of scrolling, 3 s of idle) |
| Uncached topic open | press to header and stored rows | It failed on the 9.5 ms added to the first frame above; three sign-ins |
| Topic reopen | Main and a 600-reply thread, press to rows painted | The most common action, with Slack answering in 150 ms |
| Send in Main | Enter to the pending row, with a 1 s model | The write path: the checks on send, the transaction, the delta and the paint |
| 300-message thread scroll | continuous sweep frame work | Rendering cost of a long, mixed list |

Outside the set, run on demand: quick start with its full first sync and the preview check, the first opens in a second app (three relaunches), All topics, the chat and its panel, the sidebar and chat scrolls, the sidebar drag, the filter change, typing, live updates, search and the palette, Home, the media viewer, peek, the code-block topics, the tab switches and the cached and prefetched opens, the selection drag and the emoji picker. They left the default run, and every full run, on 10-26. Most were not steady on the laptop (the cached open, typing, live updates, search keystrokes, the chat, All topics); the steady ones cover paths the set already crosses (a filter change and a tab switch are renders of lists the opens and the scroll draw). The package budgets (the engine's and agent's `*.perf.ts`) are outside it too: their p95s of a few milliseconds were not steady on the laptop (the sidebar query moved 1.4 times between runs), and the warm start and the opens time the same queries end to end. Counts of long animation frames and dropped frames are printed on the laptop, not recorded. Until 10-26 the only real regressions a scenario caught were on the Mac: the All topics scroll's held-clock sweep (a stale caret, 10-17) and an open that jumped 31 px (the feel suite, 10-17).

**Focused runs.** An agent changing the hot path of one area runs that area's scenarios before it reports: `bun run remote --cores 2 perf --area <area>` on the laptop (or `-g "<pattern>"`, which `bun run affected --plan` names per interaction), and `bun run perf --area <area>` on the Mac when Tushar asks. The areas (`AREAS` in `scripts/perf.mjs`): `startup` (main, preload, the first screen, sync before rows), `sidebar` (rows, filters, resize, the sidebar's queries), `topic` (opening, the message list, tabs, peek, live updates, the media viewer), `scroll` (any list's scroll path), `composer` (typing, mentions, send), `search` (the palette, the Search tab and their queries), `chat` (the Juno tab and panel, the agent), `home`, `emoji` and `memory`. On the laptop the small set's metrics are checked against the baseline and the rest are printed: when one looks off, run the same area on `origin/main` in a worktree and compare. On the Mac every metric is checked against its absolute budget.

Scroll scenarios trace the renderer over CDP and check the main thread's work per frame, the long animation frames and the dropped frames. To explain a number, `JUNO_PERF_TRACE=<dir>` writes a trace and a CPU profile per traced scenario, `JUNO_UNMINIFIED=1` builds with function names (the bundle check is skipped), and `bun scripts/perf-trace.mjs <dir>/<name>.trace.json [measure]` sums the main thread's time by trace event and by function inside each `juno.*` measure. For the warm start, `JUNO_E2E_STARTUP_TRACE=<file>` traces the start itself (8.8). Add `JUNO_TRACE_SKIA=1` to record the GPU process's raster passes too (blurs, image filters, pipeline compiles); a keystroke that is slow after its frame callback is usually raster, and shows there.

Each scroll scenario runs three kinds of sweep, twice each, over the same distance down and back, and pools the two of a kind before taking the p95. The **continuous** sweep is one scroll gesture with a delta every frame (CDP `Input.synthesizeScrollGesture`, mouse source, 2,000 px/s), as a trackpad sends; it carries the 8.3 ms gate (owner's decision, 10-17, section 8.5). The **stepped** sweep is 200 px wheel steps 100 ms apart, each its own gesture; its p95 is reported, not gated. The **held-clock** sweep repeats the stepped one with two background worker threads busy and has its own 7 ms gate. Both gates must pass; neither substitutes for the other. The workers end in a `finally` block. `holdClock()` lives in `e2e/perfStats.ts`. A three-second idle gap separates pairs. The trace marks the measured region, excluding trace startup, its settling interval and collection. The continuous and stepped sweeps both fail on a visible placeholder, a long animation frame or 1 % dropped frames, and both count toward the dirty-layout ceiling.

The trace also reports dirty layout objects and styled elements in frames over 8.3 ms. A separate structural check limits dirty layout objects across the continuous and stepped sweeps' measured frames, so a faster clock cannot hide extra layout: 256 for All topics (the fixed-row trace reaches 128), and 2,000 for the in-flow sidebar, messages and chat lists. These are regression ceilings for the fixed test fixtures, not replacements for the 8.3 ms budget. With `JUNO_PERF_TRACE` set, the harness saves layer sizes and compositing reasons beside each trace and CPU profile. `JUNO_TRACE_EXTRA=<categories>` adds Chromium trace categories, comma separated; `renderer` and `input` show the selection and editing work in a frame (`WidgetBase::UpdateSelectionBounds`, `VisibleUnits::canonicalPosition`). Profiled runs are diagnostic; final numbers use the ordinary trace categories without a CPU profile. `bun scripts/perf-frames.mjs <dir>/<name>.trace.json [--sequence <n>]` splits a scroll sweep's frame work the way the gate counts it into stages (script, GC, input, applying the scroll offset, style, layout, prepaint, paint, layerize, commit), for all frames and for those over 8.3 ms, and lists the heaviest frames. Read stage sizes from a trace without extra categories: the invalidation-tracking categories make prepaint and DOM removal several times slower.

The desktop harness uses `apps/desktop/playwright.perf.config.ts`, which selects `e2e/perf.spec.ts` and `*.perf.spec.ts` with the desktop configuration and one worker by default. The scenarios use the e2e fixtures and typed driver. The driver reads app marks through `juno.measure()` and `juno.measures()`; trace helpers inspect renderer work through CDP. Each scenario defines its own repetitions, warmups and budget assertions.

`largeSeed()` in `@juno/fake-slack` generates deterministic workspaces on demand. Its defaults and content mix live in `packages/fake-slack/src/seeds/large.ts`. The large-workspace group in `perf.spec.ts` uses a smaller seed, syncs it once into a temporary user-data directory, then relaunches warm for each scenario. The warm-start measurement discards its first launch. First-sign-in scenarios create fresh user data and include sync, with fake latency and production pacing. Other scenarios use the default fixture or the dedicated 300-message topic seed. Fixtures are created for the run and removed afterwards.

The scenarios cover startup, Home and topic opening, cached and prefetched topics, tab restoration, filters, typing, sending, live updates, scrolling, selection and the Juno panel. Memory checks read each process's private memory after scrolling and after heavy use: the physical footprint on the Mac, the private pages from `/proc` on the laptop. `quick-start.perf.spec.ts` checks first-sync timing; hover prefetch without a Slack call is the DOM lane's (`dom/topic.test.ts`). See the specs for the current scenarios and thresholds.

`perfStats.ts` prints median, p95, sample count, load average and competing checkouts. Timing assertions in `perf.spec.ts` use soft failures so later measurements still run; missing data and invalid setup can stop a scenario. `e2e/no-skips.ts` fails the run if a scenario did not run. There is no automatic retry for noisy samples. Every budget check writes `perf-metrics.json` in its test's output folder, which the baseline update reads.

`scripts/check-bundle-size.mjs` checks the bundle during `bun run build`. The engine benchmark in `packages/engine/test/perf/topics-large.perf.ts` boots the engine on the large fixture and reports sidebar query time alone and inside the engine, snapshot and delta sizes, encode, clone and decode times, and inject-to-row time with the load average. `bun run perf --unit` (`scripts/perf.mjs`) runs it and fails it on the budgets. On Apple silicon, power management can make the first query after an idle gap slower than a query on a busy CPU. Read the load and setup alongside the samples; the initial measurements are in `docs/architecture.md` section 16, M3.

### 7.3a The feel suite

The feel scenarios (`apps/desktop/e2e/feel/`, described in `docs/development.md`) check the rules in section 4 that a timing cannot: content that arrives late does not move what is on screen, a topic opens at its position with no later jump, feedback shows in the next frame, a tab restores before its first paint, and no frame is empty between two states. It records frames and DOM probes per animation frame and counts frames rather than timing them, so it can fail the run on a loaded machine. Only its long-frame check uses durations (over 100 ms with the page's own work in it fails in `bun run test:feel` on the Mac; on the laptop, where full runs check the scenarios beside other jobs, it only warns).

Every full run covers six scenarios, for the surfaces a person lives in: the sidebar filling during the first sync and reordering as replies land, a long thread opening at its bottom and at its divider while late images arrive, typing a mention, a send from Home, and a tab restored before its first paint. The sidebar's first sync caught bot channels showing in All and then leaving it (10-17), and the tab restore a saved position read before far rows had drawn; the long thread, the mention and the send guard the open, keystroke and send rules. The other scenarios (Settings, sheets, the Juno pages, review sheets, the picture page, the launch, the welcome card, the 30 s idle opens) are `@on-demand` (decision 10-26): `bun run test:feel` on the Mac runs all of them, and `bun run remote --env JUNO_ON_DEMAND=1 test:desktop --project=feel` runs all of them on the laptop.

The `home-first-sync` scenario records Home opening with history held, then
releases pages until rows paint and completes sync. It checks the first Home
frame's greeting and sync text, the reserved list box, and every painted row
by identity on every frame, including sync completion. Rows must fill from
the top, fit the reserved space, and never move or disappear.

### 7.4 Review checklist for any UI, list, IPC, query or startup change

1. Does the interaction paint on the next frame? Trace it once.
2. Does the change add work to scroll, to a tick, or to every row? The counted budgets fail on more statements, renders, messages or layouts; for time, measure the scroll scenario.
3. Does anything new run before the first sidebar paint? It must be on the deferred list or justified.
4. Does the query have an index and a window? Run the plan test.
5. Does a live query message grow? The counted budgets count its bytes; check the size budget too.
6. Did memory or bundle size move? Check the report.

## 8. Known gaps

- **Local Codex first text (WP20).** Codex is exempt from the plan's 1.5 s first-text target. S3 measured 5.2 s on Codex CLI 0.162.1; this is a spike measurement, not a guaranteed bound. The status bubble appears on the normal local budget and says “Waiting for Codex” until an actual tool call supplies progress. No simulated progress or timed promise of completion. Session reuse avoids a fresh roughly 20,000-token Codex prompt on every turn, but does not promise a latency improvement.

- **One-frame budgets on a 60 Hz display (accepted 10-14).** The tab switch, the prefetched open and hover are budgeted at 16 ms p95, measured from the input to the frame presented. That includes the wait for the next refresh, which is uniform over one refresh interval: 8.3 ms at 120 Hz, 16.7 ms at 60 Hz. The perf scenario "frame floor" times a pointerdown that does no work at all; on the 60 Hz test machine it measured a median of 9.2 to 10.5 ms and a p95 of 15.8 to 16.9 ms over three runs of 30 presses. So at 60 Hz the 16 ms p95 is under the floor and no code can meet it. The proposal: a one-frame budget is one refresh interval plus 8 ms. At 120 Hz that is 16.3 ms, today's number; at 60 Hz it is 24.7 ms. The 8 ms is the work a 120 Hz frame allows, the same as the scroll budget, and it is what a regression would eat. `perf.spec.ts` applies this rule when the measured refresh interval is over 10 ms. The owner accepted it on 10-14 and section 1 states it.

- **Sidebar scroll frame work.** The sidebar missed the 8.3 ms p95 on some sweeps of the 1,200-topic seed: 5 to 13 ms. Traces showed JavaScript in the scroll frames. Each wheel step slid a new row under the still pointer, and its `pointerenter` ran the topic prefetch (mount a subscription, evict the oldest, post to the engine) and the cut-off title check, which forced a style and layout. The garbage from the prefetches added collector pauses. Rows now skip that work when they move under a still pointer (`pointerMoved` in `@juno/ui`; a real move onto a row still warms it), and `perf.spec.ts` fails if a scroll records a `juno.prefetch` mark (a browser lane test of it passed with the guard turned off: headless Chromium sends no pointer events for a scroll under a still pointer). Measured in one exclusive run on the 60 Hz test machine, before then after: p95 work per frame went from 8.1 ms (first pass) and 9.8 ms (second pass) at load 4.1 to 4.3, to 7.5 ms and 6.2 ms at load 8.8 to 9.1. What is left is about 4 ms per wheel step over two frames: Chromium applying the scroll offset (`ScrollLayer`, about 1 ms), restyling the two rows whose `:hover` changes (an inherited custom property restyles every element in the row), `content-visibility` unlocking the rows that come near the viewport, and the fixed prepaint, paint and layerize cost of each frame. An earlier reading blamed the custom `::-webkit-scrollbar` (global.css) for one of the frames; measured on 10-17 it adds no main-thread frame and no work (section 8.5). Turning `content-visibility` off made frames slower.
- **The hover toolbar on every message row (fixed 10-15).** Each row renders its toolbar (three quick reactions, a divider, up to four icon buttons), 21 elements, 70 % of an open topic's DOM (3,150 of 4,523 elements for 150 rows). It was hidden by opacity only, so every toolbar was styled and laid out whenever the list was: when a topic opened and on every frame of a sidebar drag, which reflows the message pane. With it removed altogether a prefetched open went from a median of 18.4 to 19.0 ms down to 17.4 ms, and the drag's p95 work per frame stopped crossing 8.3 ms (it did in 3 of 6 runs with the toolbar, 0 of 6 without). Now the toolbar's slot is `display: none` until the row is hovered, focused or held (`--row-toolbar-display` in `Message.tsx`); it is absolutely placed in a reserved slot, so showing it moves nothing. Interleaved, three runs each at load 2.5 to 4.5, before then after: drag p95 6.2, 5.5 and 10.2 ms, then 5.7, 5.6 and 5.6 ms; prefetched open median 18.3 to 19.7 ms, then 17.3 to 18.0 ms. The elements are still created (`perf.spec.ts` logs how many toolbars are laid out: one at most).
- **Warm start (10-15).** Over its 500 ms median on every commit measured, back to the merge that first asserted it (`cbe20cc3`, 729 ms; 593 to 767 ms at five merges of 10-15, load 3 to 6), so it was not one of the 10-15 merges. Against a bare Electron app launched the same way (main to page start 241 ms, to first paint 302 ms), the scenario's log and main-process marks showed where Juno's start goes: 40 ms more to load main's bundle, 80 ms in `app.dock.setIcon` decoding the 1,024 px dev icon before the window opened, the window itself (about 80 ms, as in the bare app), then from the page start the bundle run by +70 ms, the shell by +90, the engine port by +95, the first sidebar snapshot by +150 and the rows by +190. The Dock icon is set only in an unpackaged run, so the packaged app never paid it; tests no longer do (`JUNO_E2E`). Interleaved, three runs each: median 629, 534 and 558 ms before, 469, 486 and 501 ms after. What is left near the budget: the renderer sends its first subscriptions only after it commits the shell (about 25 ms after the port is open; the engine answers in 1 to 2 ms), and Home renders on the start path when no tab is open (about 10 to 25 ms, measured by hiding it). Follow-up on 10-15 (`perf-fix-2`), measured against a bare Electron app and with startup traces: main's own module load is 9 ms, not 40 (the rest before it is Electron's start, as in the bare app), so lazy-loading main's chunks would save almost nothing. The renderer's time from page start to rows went from a median of 207 ms to 179 ms over 15 launches each (fastest 167 to 154 ms) with three changes: the font preload, the engine port asked for by the preload, and the sidebar's request sent before the shell renders. The engine answers the first `topics.list` 14 to 18 ms after the request; asking for a 40-row first window instead of 300 saved about 10 ms and was not done. Warm start on this machine still swings with load, because from main's creation to the page's start (Electron's own work, about 250 ms in a bare app) is what other processes slow down.
- **Open miss: Juno chat scroll frame work (10-15).** The chat scenario (`perf.spec.ts`, "Juno chat", 320 rows, the window moving as it scrolls) measured a p95 of 9.0, 8.2, 6.9 and 10.7 ms of main-thread work per frame over four runs on the shared 60 Hz machine at load 2 to 5, with a median of 0.3 to 0.5 ms, no long animation frame and no dropped frame. The heavy frames are the layout and paint of rows coming into view. Bubble rows now take their own off-screen estimate, `--row-bubble-estimate` 38px, instead of the message row's 56px. The Juno panel opens on the newest 40 rows rather than 200, which brought `juno.panel-open` from a median of 22.3 ms to 13.7 ms (p95 20.3 ms, inside the 24.7 ms one-frame budget at 60 Hz). `bun run perf` fails on the scroll number until it holds under 8.3 ms.
- **Scroll frame work near the budget (10-15).** On the merged main of 10-15, with the suite measuring every scenario again, the first passes missed the 8.3 ms p95 on a quiet machine (load 3 to 4.6): sidebar 9.5 ms, All topics 12.0 ms, the 300-message thread 9.6 ms. In a traced run at load 10 to 15 the same scenarios passed (sidebar 5.9 and 4.9 ms, All topics 7.0 and 6.7 ms), which fits the power-management effect in 7.3: a busy CPU runs each frame faster. The frames over budget are rendering (`BeginMainFrame`: style, layout, paint), not JavaScript. No long animation frames and at most one dropped frame in any of these runs. Follow-up: run with and without two background busy loops that keep the cores clocked up, alternated, the p95 work per frame fell from 11.3 and 11.4 ms to 7.1 and 8.5 ms for All topics and from 7.9 and 8.9 ms to 5.3 and 6.3 ms for the sidebar's second pass. The same frames cost 25 to 40 % more when the CPU has been idle, which is also what a person scrolling after reading gets, so the budget is not unfair; the gate keeps measuring this case. What makes the numbers untrustworthy is other checkouts running Electron outside the heavy-job lock: every result now names them (`contention()` in `perf.spec.ts`). Proposed next: pool the frames of two sweeps before taking the p95 (more samples, same statistic), run each sweep a second time with the cores held up and print it beside the gated one, so a miss shows how much is the clock, and count layout objects and styled elements per heavy frame from the trace, which do not depend on the clock. Removing the custom `::-webkit-scrollbar` did not change these numbers (two alternated runs each), so the claim above that it adds a main-thread frame per step does not show in work per frame. All topics' row slots now have a fixed height and `contain: strict`: in traces at the same load the sweep's layouts took 263 ms instead of 593 ms, p90 2.8 ms instead of 5.4 ms.
- **Topic open, uncached (10-15).** One sample in five or so ran 56 to 180 ms against 50. Two causes. The open made two round trips one after the other: the messages were asked for only once the header had arrived (30 to 40 ms between them in every sample); `whenReady` now asks for both at once, and the fastest samples went from 34 to 48 ms to 26 to 31 ms. The slow tail is frames that wait with nothing of the page's in them (long animation frames with no scripts and little blocking time), late in a fresh sign-in, under load 6 to 10 from other checkouts; the topic's own query took 1 to 3 ms in all of them.
- `content-visibility: auto` makes the scrollbar an estimate until rows have been rendered once. With `auto` sizing and a good per-style estimate this is invisible in practice; the scroll scenario checks that the scrollbar thumb does not jump more than 2 px during a page-down.
- The LoAF observer attributes scripts only on the main thread; engine stalls show up as late `live-update` measures instead.
- `app.getAppMetrics()` reports working set, which overstates shared memory; the private figure from inside each process is the one the budget uses.
- CDP sessions on Electron pages are not documented by Playwright but work because the page is a Chromium target; if a Chromium upgrade breaks them, the `contentTracing` path is the fallback.

### 8.1 Follow-up measurements (10-15, perf-fix-3)

The exclusive run after merging `0a462578` passed 11 of 18 scenarios. Budgets are unchanged. The measurements below come from one run; the preceding handoff used separate scroll sweeps, so its scroll p95 is not directly comparable to the pooled statistic.

| Scenario | Handoff | Exclusive follow-up | Budget |
| --- | --- | --- | --- |
| Thread send | 130–545 ms slow sample, about 30 ms median | 35.7 ms p95, 25.7 ms median, 9 samples | 50 ms p95 |
| Warm start to rows | 713 ms median | 599.5 ms median | 500 ms median |
| All topics scroll | 11.4 ms p95 | 13.9 ms pooled p95; 6.8 ms held-clock | 8.3 ms p95 |
| Home open, including 31 s idle | 81 ms p95 | 106.1 ms p95 | 50 ms p95 |

Other misses in this run: sidebar scroll 9.2 ms (held-clock 4.6), chat scroll 9.2 ms (held-clock 4.1), sidebar drag 10.0 ms, uncached topic open 57.2 ms. Message scroll passed at 5.4 ms (held-clock 3.3). All four scroll scenarios had zero long animation frames and fewer than 1% dropped frames. Maximum dirty layout objects were 207 in the sidebar, 128 in All topics, 42 in messages and 22 in chat; all structural checks passed.

Findings and limits:

- **Send:** an early run with another checkout's Electron active recorded 598 ms, with checks complete at 52 ms and the command response at 55 ms. That locates most of that sample after the command response, but does not identify the cause. A later 30-sample run without another Electron passed at 45.2 ms p95, as did the exclusive run. This does not prove the rare stall is fixed. Bounded check, response and commit marks now distinguish the remaining stages; the harness rejects focus loss. The inherited transaction probe was removed because stack capture and synchronous file logging on every transaction changed the work being measured.
- **Startup:** in the exclusive run, main-to-navigation took 319–937 ms; the page then took 193–229 ms to paint rows. Alternating probes of window-before-engine, engine-after-paint and disabled code caching gave no reliable gain; deferring the engine delayed data. A separate five-pair probe of disabling throttling only until first paint gave medians of 1,268 ms unchanged and 1,196 ms modified, with ranges spanning 440–1,746 ms. This is too noisy to retain. All startup probes were reverted; code caching and background throttling remain enabled.
- **All topics:** the held-clock comparison confirms a substantial clock effect, while the ordinary reading still represents the user-visible workload and still fails. Traces show bounded layout and rendering work. An opaque scroller background and scroller containment neither changed the relevant compositing layer structure nor reliably reduced frame work, so both were reverted.
- **Home:** cold traced opens included 27–46 ms of native layout, while the home query took roughly 1–3 ms. Holding the clock did not reliably improve the cold opens. Starting the query on pointerdown did not help and was reverted. The exclusive run also had a 503 ms outlier whose cause remains unresolved. The evidence does not support attributing Home's miss solely to the clock.

Local logs and diagnostic traces are in the ignored `.juno-status/perf-fix-3/` directory. Profiling runs were used for attribution only, not for the table's final numbers.

### 8.2 Resumed measurements (10-15)

The resumed work changes the typing measurement, adds the composer and native-input controls, and increases thread send to 30 samples. It makes no new production performance change. Main through `c6dffd41` was merged into `556c4e84` before the final run. A preceding exclusive checkpoint was superseded when attachment layout and agent resolve changes landed on main; only the merged run supplies the final table below.

The baseline is the original handoff, not a new paired baseline. In particular, the original scroll p95 used separate sweeps and the original palette number used thresholded, rounded Event Timing. Their differences from the final measurements must not be presented as measured speedups.

| Scenario | Original handoff | Final merged run | Budget |
| --- | --- | --- | --- |
| Thread send | 130–545 ms slow sample, about 30 ms median | 36.7 ms p95, 29.5 ms median, 37.1 ms maximum; 30 samples | 50 ms p95 |
| Warm start to rows | 713 ms median | 530.7 ms median, 510.3–1,649.3 ms range; 5 launches | 500 ms median |
| All topics scroll | 11.4 ms p95 | 12.3 ms pooled p95; 9.0 ms held-clock | 8.3 ms p95 |
| Palette character presentation | 56 ms Event Timing p95 | 38.9 ms input-to-presentation p95; 102 inputs | 24.7 ms p95 at 60 Hz |
| Home open, including idle | 81 ms p95 | 123.2 ms p95, 11.1 ms median; 20 samples | 50 ms p95 |

Thread send passed without reproducing the rare stall; its cause is still not proven fixed. Startup remains dominated by main-to-navigation time (308–1,433 ms in this run), followed by roughly 195–216 ms from navigation to rows. Shell paint also exceeds its 400 ms median target at 428.5 ms. Earlier startup probes did not establish a reliable improvement and remain reverted. Home's five idle opens took 62.1–235.0 ms while the queries took 1.9–3.0 ms. The saved native-layout evidence explains part of the cost, but not the full tail; attributing it solely to CPU clock speed is unsupported.

The final run passed 14 of 20 scenarios. All topics still spends too much time in rendering: holding the clock helps, but its 9.0 ms held-clock p95 still exceeds 8.3 ms. Its heavy frames have at most 128 dirty layout objects and 92 styled elements. The structural ceiling passes; bounded work is not necessarily cheap enough. No new rendering optimization was retained in this resumed work.

The same-run character controls read 38.0 ms p95 in the composer, 39.0 ms in the native input and 51.2 ms in the palette (40 inputs each). The separate large-workspace palette scenario reads 38.9 ms over 102 inputs; its open p95 is 15.7 ms and results p95 is 33.2 ms, both within budget. The common input-to-presentation delay remains above the one-frame budget even without application code. The corrected measurement exposes it rather than replacing presentation with a faster timer endpoint. The reported 56 ms plateau was not a palette-only cost; the remaining shared delay is not fixed.

Other scroll readings, ordinary / held-clock p95: sidebar 7.7 / 5.0 ms, messages 6.7 / 3.4 ms, chat 7.0 / 4.1 ms. Maximum dirty layout objects across all measured frames were 206, 128, 43 and 22 for sidebar, All topics, messages and chat respectively; every structural check passed. Chat recorded one long animation frame, failing its zero-LoAF rule despite the passing p95. This pause is not attributed by the final unprofiled run. Other scrolls recorded zero LoAF; all four had fewer than 1% dropped frames. Sidebar drag passed at 7.2 ms p95 and uncached open at 39.0 ms p95.

`bun run affected` passed on the merged tree (typecheck, lint, unit tests and desktop tests). The final performance log is the ignored `.juno-status/perf-fix-3/perf-latest-main-exclusive.log`; the superseded run is `perf-resumed-exclusive.log`. The final `bun run test:feel` run passed 8 of 9 tests and again showed five blank chat frames after send. Its filmstrip was inspected; the sent bubble disappears and returns. This is a separate visible failure, not a typing measurement result. The log is `.juno-status/perf-fix-3/feel-latest-main.log` and the filmstrip is `apps/desktop/feel-report/juno-first-bubble/filmstrip.png`. No thresholds were relaxed.


### 8.3 Follow-up on perf-4b (10-15)

The initial exclusive run on `0149fdd1` confirmed the inherited fixes: all ten
feel tests passed, including 98 nonblank chat frames with no flicker or layout
shift. Palette character presentation was 50.8 ms p95 against the same-run bare
input's 50.0 ms (102 inputs each). Chat scrolling was 7.6 ms pooled p95, 3.9 ms
held-clock, with zero long animation frames. Home, All topics and warm start
still missed their budgets.

Investigation and retained changes:

- **Home:** cold traces show a layout of the empty page followed by another
  layout when Home's local result arrives. Navigation now keeps the topic until
  that result, with the existing 150 ms navigation bound. A feel scenario checks
  this after the 30-second subscription TTL expires. This removes the empty loading
  placeholder before the specified entrance animation; it is not a demonstrated timing fix. Five alternating idle
  opens per version measured 64.5–205.4 ms (median 90.4) for immediate navigation
  and 57.9–180.5 ms (median 139.0) for waiting. Native style, text layout, paint
  and DOM work vary substantially between cold opens; one traced open also spent
  34 ms waiting for compositor commit completion. The evidence does not identify
  Automated, attachments or privacy as the cause of the historical increase.
- **All topics:** one profiled ordinary sweep spent 309 ms in paint, 170 ms in
  native layout and 123 ms updating the paint compositor, across 160 wheel steps.
  JavaScript was a smaller contributor. Replacing row-slot transforms with fixed
  top offsets was rejected: the unprofiled pooled p95 was 13.4 ms and maximum
  dirty layout objects rose to 273, exceeding the structural ceiling of 256.
  Strict size containment on the row itself also missed (10.0 ms pooled p95,
  7.3 ms held-clock, one long frame, maximum 212 dirty layout objects). Its
  held-clock reading did not improve, so that probe was reverted too. The
  original placement and containment are retained.
- **Long frames:** scroll reports now include the observer's full timing and
  script attribution. Several profiled All topics long frames had no attributed
  script and zero blocking time; others included native rendering work. This is
  not proof of the cause of the earlier unprofiled chat pause. Timing failures
  no longer abort later measurements in the same scenario; every limit still
  fails the run.
- **Agent cache:** the earlier failure did not reproduce. Five full-suite runs
  measured 25.8–34.6 ms p95, five isolated runs 28.7–32.3 ms. The test already
  warmed up for ten events. It now runs in a separate Vitest project after the
  other agent tests, with file parallelism disabled. The 50 ms event-to-encoded-window
  and 5 ms in-place-query p95 apply to the five runs' events together (since 10-17:
  a single run's p95 still failed now and then at 50.1 and 50.2 ms on shared
  remote machines, where 190 single runs in past logs spread from 11 to 80 ms
  with a median of 14 ms); correctness, payload
  and retained-heap assertions are unchanged. The ordered full-suite run passed
  at 30.2–35.9 ms p95. These results do not prove whether the historical failures
  were scheduling noise or a real transient stall.
- **Warm start:** no production startup change was retained. The checkpoint was
  546.2 ms median and the next run 572.7 ms; main-to-navigation and renderer work
  both varied. The prior cheap startup probes remain reverted.

Logs and traces are local, under `.juno-status/perf-4b/`. Profiled runs are for
attribution only and are not before/after speedup evidence. No budget was raised.

**Final exclusive run.** The table compares the initial checkpoint (`0149fdd1`)
with one full run of the retained changes on `7f62a622`, after merging main
through `d3b3f6a4`. Main also changed between checkpoints; these are not paired
speedup measurements. All values are milliseconds, p95 unless marked median.
The held-clock scroll value is diagnostic, not the gate.

| Metric | Initial checkpoint | Final merged run | Budget |
| --- | --- | --- | --- |
| Home open, including idle | 82.5 | 214.8 | 50 |
| Warm start to rows, median | 546.2 | 573.9 | 500 |
| Warm start to shell, median | 443.9 | 456.7 | 400 |
| All topics scroll, ordinary / held-clock | 11.9 / 7.3 | 14.8 / 7.2 | 8.3 ordinary |
| Palette character / bare input | 50.8 / 50.0 | 39.7 / 38.8 | No more than one refresh interval apart (16.7 here) |
| Chat scroll, ordinary / held-clock | 7.6 / 3.9 | 6.3 / 4.9 | 8.3 ordinary |
| Chat send to owner bubble | 22.2 | 23.8 | 24.7 on this display |
| Juno panel open | 19.8 | 26.1 | 24.7 on this display |

The final run passed 16 of 21 scenarios. In addition to the table's misses,
sidebar scrolling failed at 9.0 ms p95 (4.8 held-clock). Message scrolling passed
at 5.4 ms (3.1 held-clock). All four scrolls had zero ordinary long animation
frames, fewer than 1% dropped frames, and passed their structural ceilings.
The original chat pause was not reproduced in either unprofiled checkpoint.
Panel open had a 336.7 ms maximum; the baseline also had a 321.4 ms maximum.
Their causes remain unproven, and the final p95 still fails its unchanged gate.

Home's five idle opens were 214.8, 226.5, 40.8, 191.6 and 71.2 ms. Their query
readings were 28.0, 26.7, 2.2, 3.8 and 8.2 ms, so this final tail cannot all be
assigned to rendering. Warm start spent 331–887 ms before navigation and
197–347 ms from navigation to rows. Neither budget is fixed.

`bun run affected` passed on the final code: typecheck, lint, unit tests, gallery
and desktop tests. Its cache benchmark passed all five runs at 14.5–20.4 ms
p95, with in-place queries at 0.14–0.18 ms. The final Mac timing log is
`.juno-status/perf-4b/perf-final-exclusive.log`; the remote verification log is
`.juno-status/perf-4b/affected-final.log`.

The final `bun run test:feel` passed all 11 tests. The chat recording contained
91 frames, none blank, with no flicker or layout shift. Its filmstrip was
inspected. The new Home check passed after subscription expiry: no loading
placeholder between topic and Home. The inspected Home filmstrip still shows
the specified staggered entrance; the check is about data readiness, not making
that animation instantaneous. The log is `.juno-status/perf-4b/feel-final.log`,
and the filmstrips are under `apps/desktop/feel-report/`.

### 8.4 Main after the 10-16 merges (10-17)

Two full `bun run perf` runs on the shared M2 (8 GB, 60 Hz display, so a
one-frame budget is 24.7 ms), with no other heavy job holding the lock.
The first is main at `ae0f0f06`; the second adds the stale caret fix
(`a015ea5c`). Load was 2 to 5 in both. All values are ms, p95 unless
marked; ordinary / held-clock for scrolls.

| Metric | Main | With the fix | Budget |
| --- | --- | --- | --- |
| Topic open, uncached | 47.6 | 51.2; 43.4 on a rerun | 50 |
| Topic open, cached | 17.6 | 17.9 | 50 |
| Topic open, prefetched | 20.4 | 19.3 | 24.7 |
| Tab switch, mounted | 19.5 | 18.0 | 24.7 |
| Tab switch, unmounted with restore | 17.2 | 16.7 | 50 |
| Peek open | 19.6 | 21.2 | 24.7 |
| Home open, including idle | 79.8 | 41.3 | 50 |
| Filter change | 25.5 | 29.9 | 50 |
| ⌘K open / keystroke to rows | 14.8 / 34.3 | 17.7 / 37.3 | 50 / 100 |
| Send / send in Main | 35.7 / 33.5 | 48.8 / 34.7 | 50 |
| Live update, sidebar / open thread | 18.5 / 30.5 | 20.1 / 27.9 | 50 |
| Juno panel open | 18.8 (max 320.3) | 19.0 (max 323.7) | 24.7 |
| Chat send to your bubble | 23.4 | 23.6 | 24.7 |
| New tab with Home (New chat open until 10-17; not measured since) | 17.6 | 17.7 | 24.7 |
| All topics open | 27.1 | 25.8 | 50 |
| Warm start to shell / rows, median | 394.0 / 457.6 | 370.1 / 454.5 | 400 / 500 |
| Sidebar drag, work per frame | 10.2 | 6.7 | 8.3 |
| Sidebar scroll | 11.9 / 5.0 | 13.1 / 5.2 | 8.3 ordinary |
| All topics scroll | 22.1 / 13.3 | 18.2 / 5.9 | 8.3 ordinary |
| Message scroll | 8.4 / 3.2 | 9.6 / 2.5 | 8.3 ordinary |
| Chat scroll | 9.4 / 3.8 | 11.1 / 3.6 | 8.3 ordinary |

Keystroke presentation stayed within one refresh interval of the same
run's bare input in every surface, except the composer in the second run
(54.1 against 54.0); a rerun passed at 50.1 against 54.6. The initial JS
bundle is 996.6 KB of its 1,000 KB budget.

The first run passed 17 of 23 scenarios, the second 17 of 23, with the
keystroke and uncached misses passing on the rerun. What still fails is
the four ordinary scroll gates, as on 10-15, where held-clock readings
pass. Sidebar scroll in the second run also recorded one long animation
frame, which fails its zero rule; its cause is not attributed.

- **Topic opens and the tab switch were load, not a regression.** Under
  load 6 to 10 on 10-16 the uncached open read 156 to 198 ms, the
  prefetched open 39 to 110 ms and the mounted tab switch 29 to 38 ms. On
  a quieter Mac they pass. The no-shift branch's own runs show the same
  uncached tail on its base commit, before it held message paint. The
  hold cannot lengthen the measure: `juno.topic-open` ends on the first
  frame with the header in place, whether or not the body waits for
  coverage.
- **Stale caret (fixed).** All topics scroll went from 7 to 13 ms
  held-clock with the merge of `tabs-model-1`; a bisect over the merges
  and then the branch found `9261e202` ("never leave no tab"). That
  commit is not slow itself. Launch now opens a New chat with its
  composer focused, and a text field leaves Blink's caret behind when
  focus moves off it; once the field is removed, the caret sits where
  the field was. Chromium makes that caret canonical before every frame
  (`WidgetBase::UpdateSelectionBounds`), walking back through the DOM to
  an editable position: 4 to 6 ms a frame past the sidebar's rows. The
  10-15 commit is just as slow when the composer is focused first. Script
  cannot see the caret (`getSelection().type` is `None`). The renderer
  now clears it on the frame after focus leaves a text field for
  something that is not one, unless the user has selected text or a
  mouse button is down, which may be a drag selection starting from that
  caret; it looks again on release (`containers/caret.ts`, 8.10). Heavy frames in the All topics sweep fell
  from about 330 to 200, and the sidebar drag and Home open passed. The
  same caret appears after any removed field (the palette, a popover's
  search), so it was not only a test artefact. The cause was named by
  tracing with `JUNO_TRACE_EXTRA` categories (section 7.3).
- **Ordinary scroll gates.** The ordinary readings move by 3 to 8 ms
  between runs of one commit; the bisect's good commits read 8.2 to 17 ms
  for All topics with held-clock readings of 5.9 to 7.6 ms. Held-clock
  was the reliable signal for this regression. These gates still fail
  and are not fixed here.

`bun run test:feel` passed all 14 tests. The filmstrips for opening a topic
at its divider, both tab switches, the Juno panel, Home after idle and
the palette show each landing in one frame and holding still. The
panel's empty-state text fades in over about 350 ms after the panel
lands. There is no feel scenario for Home during the first sync; it is
covered by `layout-shift.spec.ts` only. Logs are under
`.juno-status/perf-1017/`.

### 8.5 The Juno panel's first open (10-17)

**The outlier was React's fallback throttle.** Every perf run had one
`juno.panel-open` sample near 320 ms, always the first open (in order:
320.1, 17.5, 19.5, ...). A trace of that open with `JUNO_TRACE_EXTRA`
(`renderer,input,v8,disabled-by-default-v8.gc,loading`) showed the main
thread busy for 32.8 ms of the 320 and idle for the rest: no GC, no
compile, no font or shader work, no slow composite. React had committed
the Suspense fallback and set a 294 ms timer from `performWorkOnRoot`
(`globalMostRecentFallbackTime + 300`) before it committed the panel. The
Juno chunk was already loaded on idle, but `React.lazy` suspends on its
first render whatever the import's state, because the promise its factory
returns settles a microtask later. Each lazy component pays it once, so
the first open of All topics and of ⌘K had the same wait.

**Fix.** `chunk()` in `containers/chunks.ts` loads a chunk once and makes
its lazy components. Once the chunk is in, the factory returns a thenable
that calls back at once, which `lazy` reads as loaded in the same render.
The Juno chunk, All topics and the palette use it. Nothing new runs at
launch: the chunks still load on idle after the first paint, and the
initial JS is 969.8 KB.

| Panel open, ms | Before | After |
| --- | --- | --- |
| First open | 320.1 | 26.7 |
| p95 / median of 20 | 21.0 / 17.8 | 20.5 / 14.8 |
| Feel, first open in a fresh app | | lands whole in frame 4, +45 ms |

The after run's only failure was the ordinary chat scroll gate (9.7 ms,
held-clock 3.7 ms), the known gap from section 8.4.

**Empty-state fade.** The panel replayed the empty chat's staggered
entrance (friendly-layer section 5: 240 ms parts, 80 ms apart, about
400 ms in all) on every open. That section plays it once, when the state
first appears, and never on a repeated action. ⌘J opens and closes the
panel all day, like a tab switch, which never animates. The panel now
shows the empty state with no entrance; the Juno tab keeps it. The feel
scenario `juno-panel-open` checks that the empty title is at full
opacity in every frame the panel shows. With `JUNO_PERF_TRACE` set, the
perf scenario traces the first two panel opens (`panel-open-0`, the
first, and `panel-open-1`, a usual one). Logs are under
`.juno-status/panel-1017/`.

**Remaining deferred surfaces.** Set up Juno, Settings, send checks,
attachment chips, view sheets, Account, emoji, the image viewer, the topic
switcher and New chat's deferred lists now use the same helper. Its
implementation lives in `packages/ui/src/chunks.ts`; views and
`containers/chunks.ts` re-export it without adding a dependency edge.
Settings joins the workspace's idle preload. Set up Juno warms on idle
while signed out; the other surfaces keep their existing idle or intent
preloads. The topic switcher's preload waits for idle after its deferred
rows have painted.

A cold popover mounts its frame and contents together, then clamps to its
pane. Emoji's boundary likewise contains the whole floating surface.
Attachment staging and send-check publication wait for their component's
chunk, so the composer grows once with the finished content. Frequent
rows retain one reserved slot per destination and read `chunk.useReady()`: if
they arrive before the idle import finishes, their first lazy render waits for
readiness rather than suspending and starting another 300 ms throttle. Full-page and image-viewer
boundaries retain their existing full-area placement.

The perf scenario `first open in a second app` signs in once, closes that
app, then measures the four first opens in a fresh renderer, each against
50 ms. It observes actual content on the first presented frame, not the
empty popover wrapper. Account, the switcher and emoji start at `click`,
their activating event, `pointerdown`. This excludes
the driver's deliberate 60 ms mouse hold from click-activated controls.
The `launch warm start` scenario also reports process creation to the
first painted, focused New chat composer (`juno.composer-ready`).

Five fresh second-app opens per build on the same Mac, measured separately
before and after (ms, median and range):

- Account: **321.4 → 17.2** (318.1–332.0 → 14.0–19.6).
- Topic switcher: **316.1 → 12.1** (309.0–318.6 → 8.2–16.2).
- Emoji picker: **336.6 → 30.4** (334.2–350.9 → 27.0–37.6).
- Settings: **319.3 → 15.9** (314.1–326.2 → 15.4–16.6).

Every final first-open sample passed 50 ms. Five warm launches per build
measured **461.8 → 444.0 ms** median to the focused composer, with ranges
423.5–535.2 and 441.7–501.7 ms. The ranges overlap; this does not establish
a startup speedup. The final initial JS is **969.8 KB** (314.3 KB gzip),
and CSS is 124.1 KB. The launch filmstrip has the composer and all Frequent
rows in its first recorded frame, with no composer movement. The four
focused feel scenarios and the New chat desktop rerun passed.

The required `bun run perf -g "open|menu|switcher|launch"` run passed seven
of eight scenarios. The remaining failure was All topics' ordinary scroll
p95, 17.9 ms against 8.3 ms (held-clock 6.0 ms), the known section 8.4 gap.
Typecheck, lint and all four desktop shards passed. The gallery geometry
check passed after the whole-popover boundary retained the gallery's
hidden code-loading marker. `bun run affected --base origin/main` also found
an engine warm-boot request-count failure at `sync.test.ts:299`: one extra
`conversations.replies` call. It reproduced in an isolated remote rerun;
this change does not alter the engine or its sync dependencies.

### Held-clock scroll gates (10-17)

Sidebar, All topics, messages and chat each keep the ordinary 8.3 ms p95
limit and also gate pooled held-clock p95 at **7 ms**. The post-caret-fix
readings above span 2.5–5.9 ms (about 6 ms): 7 ms leaves about 1 ms of
headroom at the slowest surface while rejecting the 13.3 ms stale-caret
regression. This is a common regression ceiling for these fixtures, not a
claim that all four surfaces cost the same. Each reading pools two sweeps;
the trace must contain more than 100 measured frames in each mode. Both
values remain in the run log, and either timing failure fails the run.
The ordinary gate remains unchanged despite its documented noise.

One `bun run perf -g scroll` run on this branch measured ordinary / held-clock
p95 of 10.1 / 5.2 ms (sidebar), 14.8 / 6.0 ms (All topics), 10.5 / 2.7 ms
(messages), and 9.4 / 4.0 ms (chat). All held-clock gates passed; all ordinary
gates failed. All topics also recorded four long animation frames. Every
structural ceiling and dropped-frame limit passed. The exclusive lock was
held throughout; load at each scroll reading was 3.4–4.5. This single run
confirms the gates execute, not the cause of the ordinary tail. The log is
`.juno-status/perf-gates-1017/scroll.log`.

### Home open after idle (10-17)

Home open's opens after a 31 s idle gap read 32 to 117 ms against the 50 ms
budget, while a quick open took about 10 ms (8.6).

**Holding the clock did not help.** As the scroll gates do, two worker
threads kept cores busy for the last 500 ms of the gap and the measure.
In three runs the held idle opens read 29.1, 76.8, 195.6, 17.5 / 49.7, 68.4,
56.2, 27.0 / 24.9, 20.9, 29.5, 14.3 ms and the unheld ones 78.3, 32.4, 33.8,
34.0 / 60.1, 36.5, 34.2, 27.4 / 109.8, 120.8, 78.5, 37.3 ms. Only the third
run fits the clock. In the first two, holding made `home.view` slower (5.7
to 51.2 ms against 0.8 to 5.5 ms): the workers competed with the engine.
That matches 8.1. The held reading was dropped; the scenario measures as
a person meets it.

**Where the time went.** Traced (78.6 ms): the pointerdown (9.4 ms) found
`home.view`'s subscription ended with the atom's 30 s idle TTL, so
`openHome` kept the topic on screen and started a new one; a frame painted
the topic again (18 ms); the engine's first value arrived at 28.8 ms;
React rendered Home (15 ms); one frame laid out and painted it (27 ms). A
quick open does the same in the pointerdown and one 4.6 ms frame, because
the value is already in the renderer. The same layout (21 of 969 objects
dirty) took 1.1 ms on a quick open and 8.4 to 18.8 ms after idle: every
stage runs several times slower on the CPU after idle.

**The change.** Pointer enter or focus on the sidebar's Home item warms
`home.view` (`prefetchHome`, 4.2). The open after idle then renders cached
data in the pointerdown, with no engine wait and no frame in between. The
scenario still presses right after the pointer arrives, so no hover time
is added. Its prefetch entry is still held at the idle open, so these opens
measure cached data on the slow CPU; an entry evicted by three later
prefetches is warmed again when the pointer enters the item.

| Run | Idle opens (ms) | p95 of 20 (ms) |
| --- | --- | --- |
| 1 | 19.0, 26.3, 19.2, 20.3, 20.5 | 20.5, passed |
| 2 | 24.1, 17.9, 15.5, 134.4, 93.8 | 93.8, failed |
| 3 | 24.9, 26.1, 22.2, 13.4, 23.9 | 24.9, passed |
| traced | 11.2, 11.9, 14.0, 85.5, 17.2 | 19.1, passed |

**Budget.** 3 of 20 idle opens still took 85 to 134 ms. The traced
one (85.5 ms) waited on nothing: the pointerdown took 50 ms (React 16 ms,
then the press's hit test forced the layout, 18.6 ms against 1.4 ms on a
quick open), a paint frame 11.8 ms and the compositor commit 20 ms. That
is the same work 5 to 13 times slower, which points at the CPU state
after idle rather than at Juno's work. The owner set a separate budget
for these opens on 10-17, 150 ms p95, because the CPU clock drops after
idle on this Mac; quick opens keep 50 ms (section 1). The scenario gates
its 15 quick opens at 50 ms and its 5 idle opens at 150 ms; with five
samples the p95 is the slowest one, so a single idle open over 150 ms
fails the run. Not tried: rendering Home on pointer enter, so the press
only swaps it in, which helps only if the pointer rests on the item first.

### 8.5 Scroll frame work beyond JavaScript (10-17)

The four ordinary scroll gates failed with held-clock readings well inside
7 ms. This pass asked where the rest of each frame goes, per list, and
measured each suspect on its own.

**Method.** Traces with `JUNO_TRACE_EXTRA=renderer,input,scheduler,`
`disabled-by-default-devtools.timeline.invalidationTracking,`
`disabled-by-default-blink.invalidation,disabled-by-default-cc.debug` showed
what each frame does and why (which nodes were restyled, laid out or
invalidated). Sizes come from traces with the default categories and no
CPU profile, read with `scripts/perf-frames.mjs` (7.3): the invalidation
categories made prepaint and DOM removal several times slower, and showed a
5 ms `removeChild` per All topics step that does not exist without them
(removing a row slot by hand takes under 0.1 ms). Each suspect was then
measured in the running app, on the gate's own fixtures and sweeps, by
injecting CSS or deleting the rules in question, alternating with the
unchanged page: three ordinary and three held-clock sweeps per variant. The
spread between reps of one variant is about ±1 ms of ordinary p95, so only
moves larger than that, or a change in the total work per sweep, count.

**Where the time goes.** Main-thread work in frames over 8.3 ms, ordinary
sweeps, before the fix below (ms per heavy frame; the last stage holds the
paint step's own time and the frame's untraced overhead):

| Stage | Sidebar | All topics | Messages | Chat |
| --- | --- | --- | --- | --- |
| Script and GC | 1.1 | 2.9 | 1.7 | 0.9 |
| Input and observers | 0.8 | 0.5 | 1.0 | 0.9 |
| Applying the scroll offset (`ScrollLayer`) | 1.6 | 2.3 | 0.8 | 1.7 |
| Style | 1.0 | 2.6 | 1.2 | 0.4 |
| Layout, with post-layout tasks | 1.6 | 2.1 | 2.8 | 2.3 |
| Prepaint | 0.7 | 0.5 | 0.8 | 0.4 |
| Paint and frame overhead | 2.4 | 2.3 | 1.5 | 1.8 |
| Layerize | 1.7 | 1.4 | 0.8 | 2.5 |
| Commit | 0.1 | 0.1 | 0.2 | 0.2 |
| Total | 11.0 | 14.7 | 10.8 | 11.1 |

Raster, the compositor thread and the GPU process are not in the gate. They
used 0.5 to 1 ms (compositor) and 1.3 to 3 ms (GPU) per heavy frame, and
dropped frames stayed under 1 %. Paint caching works: 4 to 65 of 300 to 900
display items are recorded again per paint.

- **Sidebar.** A wheel step costs about four rendering frames. In the first,
  the scroll offset is applied and the two rows whose `:hover` changes are
  restyled. In the second, about six rows that come near the viewport leave
  `content-visibility` skipping and get style, layout and prepaint. The
  other two end the scroll gesture (each Playwright wheel step is a gesture
  of its own) and skip the rows that left the viewport again. Every
  rendering frame pays about 1 ms of layerize and 1 to 2 ms
  of paint bookkeeping whatever changed. No single cost dominates.
- **All topics.** The whole step lands in one frame: the virtualizer
  re-renders with `flushSync` inside the scroll event, then reading the
  scroll position forces style and layout, and the four new rows are styled
  and laid out (about 86 elements and 120 layout objects).
- **Messages.** Layout of the row that slides under the pointer, whose
  toolbar is now displayed, and of rows leaving `content-visibility`
  skipping.
- **Chat.** Layerize and applying the scroll offset.

**What each suspect is worth** (ordinary / held-clock pooled p95 of three
sweeps, ms; each pair from one run, alternated):

| Variant | Sidebar | All topics | Messages | Chat |
| --- | --- | --- | --- | --- |
| Unchanged | 11.3 / 6.3 | 16.2 / 7.1 | | |
| No row hover (`pointer-events: none` on the list) | 11.1 / 5.6 | 16.1 / 6.8 | | |
| Native scrollbar (`::-webkit-scrollbar` rules removed) | 11.2 / 5.0 | 16.4 / 6.5 | | |
| `content-visibility: visible` on the rows | 11.7 / 5.1 | | | |
| No art cross-fade | 11.3 / 5.3 | | | |
| Unchanged | 11.0 / 5.1 | 16.2 / 6.7 | | |
| No universal `::before`/`::after` rule | 10.5 / 6.0 | 16.1 / 6.8 | | |
| Sticky header made static | 10.0 / 5.3 (no-op here) | 15.5 / 6.7 | | |
| All of hover, `content-visibility`, art, pseudo rule | 11.1 / 5.0 | 15.7 / 6.9 | | |
| Unchanged, with the fix below | | | 10.0 / 3.0 | 9.8 / 3.2 |
| No row hover, with the fix | | | 10.9 / 3.0 | 9.9 / 3.2 |
| `content-visibility: visible`, with the fix | | | 11.0 / 3.0 | 9.7 / 3.3 |
| Unchanged | 11.9 / 5.2 | 16.9 / 6.5 | 11.0 / 3.0 | 10.5 / 3.5 |
| **No app regions** | **11.0 / 4.5** | **14.3 / 5.7** | **10.7 / 3.5** | **9.2 / 2.6** |
| Work per sweep without app regions | −14 % | −18 % | −6 % | −7 % |

None of the candidates named earlier in section 8 moves the ordinary p95: not the
hover restyle, not `content-visibility`, not the art fade, and not the custom
scrollbar. The art fade runs only while the art job is still drawing, in
the first sweep: art that arrives while a row is skipped by
`content-visibility` keeps the row's old style, so the placeholder fades
out (240 ms) when the row scrolls into view, not when the art arrived.
That contradicts `TopicArt`'s rule that art present on the first paint
shows at once. It is a look issue, not a cost, and is fixed in the art
fade section below. The scrollbar does not add a main-thread frame either: a sweep
draws the same number of frames with the native one (237 to 283 against
236 to 243 for the sidebar, 469 to 481 against 464 to 476 for All
topics). Swapping it would change the look and buy nothing, so it needs no
decision. Hiding the other pane's content (`visibility: hidden`) changed
nothing, so the per-frame cost is not the size of the rest of the page.

**Fix: app regions only on the title bars.** Every interactive primitive
set `-webkit-app-region: no-drag` (`internal/interactive.ts`). The property
is inherited, so about 1,000 elements of an ordinary page and 4,600 of an
open topic carried a region, and every row, chip and button of a scrolling
list moved one. Without them Chromium took about half as long to apply each
scroll offset (sidebar 0.5 to 0.24 ms a frame, All topics 0.65 to 0.3, chat
0.33 to 0.08) and less time after each layout. `no-drag` only matters inside
a `drag` strip, and only the two title bars are drag strips. The tab
strip's slots and the history group already opted out on their containers.
The sidebar's icon group now does too, and the primitives set nothing. The
`app.spec.ts` title bar test checks that every control over a drag strip is
covered, and that regions start on fewer than 20 elements.
Every surface that can open over a title bar sets `no-drag` once, on its
root: `Popover`'s panel (the avatar menu, the topic switcher, the view sheet,
the New chat pickers), `OptionList`, the palette's overlay, `Floating` (the
emoji picker and the selection quote), the @ and # suggestions, `SheetLayer`
and the image viewer. The first commit of this fix missed `Floating`, the
suggestions, `SheetLayer` and the image viewer, which had relied on their
controls' own `no-drag`; on a real Mac a press there could drag the window
(the avatar menu bug of 10-16). A second `app.spec.ts` test opens each listed
surface and fails unless the nearest absolutely or fixed placed box around it
is `no-drag` with nothing inside set to `drag`. The tab menu and the topic's
⋯ menu are native menus, outside the page.

**Measured, not shipped: no `flushSync` in All topics.** With the
virtualizer's `useFlushSync: false` the new rows render one frame after the
scroll, inside the 6-row overscan. Ordinary p95 went from 16.6 to 13.6 ms
(4 reps each, 15.4 to 17.3 against 11.8 to 14.0) and held-clock from 6.1 to
5.8 ms, but the work per sweep rose by 19 % (2,226 to 2,644 ms), because
each extra rendering frame pays its fixed cost again. It still misses
8.3 ms, and a fling faster than the overscan per frame would show empty
space for a frame. Left as is.

**The rest is the clock.** The same sweeps run 2 to 3.5 times faster with
the cores held up (messages 10.0 against 3.0 ms). The renderer's main
thread runs at user-interactive priority (47), so this is not a
backgrounded window. Each wheel step is a burst of 3 to 9 ms after about
90 ms of idle, and the CPU runs the burst at a low clock. With the fix, the
held-clock p95 is 2.6 to 5.7 ms, inside the budget, and no
change tried here brings the ordinary reading under 8.3 ms. That needs a
decision (below).

**The long animation frames in All topics.** Five long frames in the traced
run, matched to the trace by time: four are the first or second wheel step
of a sweep, 36 to 380 ms after it starts, which follows the 3 s idle gap.
That step does the usual work (two hover rows and one new slot to restyle)
but every stage runs 5 to 13 times slower: 10.6 ms to apply the scroll
offset against 0.8 ms later, 8.6 ms of style for four elements. The other is
a major garbage collection (32 to 50 ms, mostly marking) that lands on a
step. LoAF entries show no scripts and no blocking time for both kinds,
since neither is a script. The four in the gated run of 10-17 have the same shape (no scripts; 56 to 225 ms; two with a wheel event in them and two without), but that run saved no traces, so they are matched by shape, not by time.

**Decision (owner, 10-17): gate a continuous gesture.** The stepped sweep
drives the list with 200 px wheel steps 100 ms apart, each its own scroll
gesture; a trackpad on a 120 Hz display sends a delta every frame within one
gesture. The 8.3 ms gate now runs on a continuous gesture at 2,000 px/s
(section 7.3); the stepped p95 is still printed, and the 7 ms held-clock
gate, the long-frame, dropped-frame, placeholder and layout checks are
unchanged. The budget is unchanged. First run, ms (load 2.4 to 3.5, 8.1
during the sidebar reading):

| List | Continuous (gated) | Stepped (reported) | Held-clock, stepped (gated) |
| --- | --- | --- | --- |
| Sidebar | 6.3 | 11.7 | 4.2 |
| All topics | 6.3 | 16.5 | 5.3 |
| Messages | 6.7 | 10.7 | 2.6 |
| Chat | 4.4 | 10.7 | 3.1 |

All five scroll scenarios passed, with no long animation frame and at most
0.2 % dropped frames. A gesture moves each list by 17 to 33 px a frame, so
few rows enter per frame. The stepped numbers still show what a single large
wheel step after a pause costs.

**Gate results.** `bun run perf -g scroll`, before and after the fix, back
to back on the quiet Mac under the exclusive lock (load 2.5 to 3.4), ms,
ordinary / held-clock pooled p95:

| List | Before | After | Budget |
| --- | --- | --- | --- |
| Sidebar | 12.1 / 5.0 | 9.3 / 3.9 | 8.3 / 7 |
| All topics | 14.9 / 6.1 | 14.9 / 5.3 | 8.3 / 7 |
| Messages | 10.5 / 2.6 | 9.9 / 2.9 | 8.3 / 7 |
| Chat | 11.9 / 3.6 | 10.3 / 3.3 | 8.3 / 7 |

All held-clock gates pass and all ordinary gates still fail. Neither run
recorded a long animation frame; dropped frames were 0 to 2 per sweep set,
and every structural ceiling passed. One gate run moves by about ±1.5 ms,
so the interleaved A/B numbers above are the better measure of the fix.
`bun run test:feel -g scroll` (the scrolled tab restore) passed. Logs and
traces are under `.juno-status/scroll-frames/`.

### Art that arrives off screen (10-17)

The 10-17 scroll pass found that a row whose art arrived while it was
skipped by `content-visibility` played the placeholder's 240 ms fade when
it scrolled into view, so rows came in looking as if they were loading.
A CSS transition starts when the element's style is next computed, and a
skipped row's style is not computed until it comes near the view.

**Fix.** `TopicArt` no longer uses a transition. When the art arrives or
goes, a layout effect starts a Web Animation on the placeholder layer.
It runs on the document clock from that moment whether or not the row
renders, so a row that renders later finds it finished and shows the art
at full opacity on its first frame; a row on screen still fades. The
layers set `transition-property: none`, because under reduced motion
`global.css` gives every element a 0.01 ms transition, which drew one frame
of the placeholder in the same way. Nothing runs per row while scrolling:
the effect runs only when the art changes.

The gallery test `apps/gallery/topic-art.spec.ts` gives the
last row of a 30-row sidebar its art while the row is skipped, waits past
the fade, scrolls it into view and reads the placeholder in the first
frame drawn: opacity 0 and no running animation, with and without reduced
motion. On the old code it read opacity 0.94 with a running transition.

### 8.6 A quiet-Mac pass after the 10-17 merges (10-17)

Full `bun run perf` and `bun run test:feel` runs on the shared M2 (60 Hz, so a
one-frame budget is 24.7 ms), at night with no other agent's job holding
the lock. "Before" is main at `10317936`; "after" is this pass's branch on
main at `4574f250`, which also keeps the engine's background AI jobs off in
tests (`49a76117`). Load was 2 to 5.5, except warm start in the first run
(7.7). ms, p95 unless marked.

| Metric | Before | After | Budget |
| --- | --- | --- | --- |
| Topic open, uncached | 38.3 | 36.0 | 50 |
| Topic open, cached / prefetched | 18.0 / 20.2 | 18.1 / 19.5 | 50 / 24.7 |
| Tab switch, mounted / unmounted | 18.4 / 19.2 | 19.0 / 18.0 | 24.7 / 50 |
| Peek open | 12.1 | 15.5 | 24.7 |
| Home open, including after idle | **116.5** | **65.1** | 50 |
| Media viewer open | did not run | 11.0, from the click | 50 |
| Filter change | 21.8 | 21.8 | 50 |
| ⌘K open / keystroke to rows | 12.7 / 30.8 | 18.2 / 29.4 | 50 / 100 |
| Send / send in Main | 35.1 / 41.7 | 35.7 / 39.0 | 50 |
| Live update, sidebar / open thread | 15.8 / 26.3 | 19.4 / 28.1 | 50 |
| Row hover | 13.1 | 7.5 | 24.7 |
| Juno panel open / chat send to bubble | 18.7 / 21.2 | 17.8 / 22.3 | 24.7 |
| New chat open | 18.1 | 18.0 | 24.7 |
| All topics open | 23.6 | 19.5 | 50 |
| First opens in a second app (account, switcher, emoji, Settings) | 16.3, 15.5, 34.0, 20.6 | 16.8, 16.2, 33.1, 18.1 | 50 |
| Warm start to shell / rows, median | 375.6 / 490.6 | 385.7 / 438.8 | 400 / 500 |
| Sidebar drag, work per frame | 6.7 | 6.4 | 8.3 |
| Sidebar scroll, continuous / held-clock | 5.0 / 4.2, **2 long frames** | 5.7 / 4.0 | 8.3 / 7 |
| All topics scroll | 6.6 / 5.2 | 5.7 / 4.7 | 8.3 / 7 |
| Message scroll and prepend | **stopped at 250 rows** | 6.4 / 3.5, 0 px shift | 8.3 / 7 |
| Chat scroll | 5.2 / 3.6 | 4.8 / 3.6 | 8.3 / 7 |

Keystrokes stayed within one refresh interval of the same run's bare
input in every surface (after: composer 51.8 against a 56.1 budget, emoji
58.4 against 71.2). The initial JS is 1,047.0 KB of 1,100 KB.

The first run passed 21 of 25 scenarios, the after run 24 of 25. The feel
suite went from 14 of 18 to 18 of 18.

- **Uncached topic open was load.** The 195 ms reading on 10-16 was taken
  with about 14 agents on the Mac. Quiet, it measured 38.3 and 36.0 ms,
  within 50.
- **Media viewer (test fixed).** The scenario timed out: `#eng` opens at
  its divider, so the injected message sat under the composer and the
  press missed the picture. Once it was in view, the open measured
  84.6 ms, because a tile opens the viewer on `click` and the measure
  started at `pointerdown`, holding the driver's 60 ms press. It is now
  timed from the click, as the first-open popovers are (decision log,
  10-17 05:17); the budget is unchanged.
- **Open at the bottom jumped 31 px (fixed).** A bisect over the merges
  found `5820838d` (engine-small-1017). Since `893855e8`, a reply that a
  search match stored is `partial` and the open fetches the thread's
  replies again, which is how its reaction is first stored. But the
  message query still counted partial replies as covering the window, so
  the topic painted the search matches and the reaction grew the message
  a frame later. The coverage check now counts only full replies, as the
  open's own check does, so the body waits for the replies page like any
  partial cache (3.3). A thread known only from search now shows its header and an
  empty body until Slack answers, where before it showed incomplete rows.
  The feel scenario opens the thread once first, so its recorded open
  reads a full cache. A peek at such a thread waits for the same fetch
  before it paints (it would otherwise paint an empty list and grow); a
  warmed, covered topic still peeks in one frame.
- **Palette feel scenario (test fixed).** Since ⌘K opened on Conversations
  (`36fc9db2`), its six recent topics are on the Messages tab; the
  scenario now waits for the Frequent rows.
- **Not reproduced.** The first run's prepend that stopped at 250 rows
  and the sidebar's two long frames (234 and 361 ms, no scripts and no
  blocking time, the shape of the first wheel step after idle in 8.5)
  passed on two reruns each, on both the old build and the new main. So
  did the feel failures of the long thread with late images (an icon in
  the header moved 40 px in frame 126) and of the tab restore (its row was
  not found within 30 s at load 8.8).
- **Open miss: Home open after idle.** Six runs of the same code read
  116.5, 38.9, 43.0, 31.9, 65.1 and 72.2 ms; every miss is in the five
  opens that follow a 31 s idle gap, when Home's subscription has expired.
  Traced, the slow ones keep the main thread busy for the whole measure
  (94.2 of 94.9 ms, 71.9 of 72.2 ms): taking down the topic (16 ms of
  `removeChild`), mounting Home (layout 16 ms, paint 11 ms, text shaping
  4 ms) and script. A quick open does the same work in about 10 ms. It
  never waits on the engine, so warming `home.view` on hover would not
  help; this is the low clock after an idle gap (8.5), which this
  scenario meets on purpose. It was red on 10-16 too (79.8 ms). Followed up in
  "Home open after idle" above.
- **Initial JS grew.** From 997.1 KB at `90928615` to 1,047.0 KB. Before
  minification the entry gained about 99 KB, spread over the day's
  features: the topic container's hooks (41 KB), the media grid (11 KB),
  the workspace strip (9 KB), tooltips (8 KB), the reactors popover
  (8 KB) and composer links (16 KB with their editor and rules), while
  the topic view and the pickers shrank. No single dependency stands out.
  Warm start passed; the 53 KB left is the room for the next features.

Logs are under `.juno-status/perf-pass-1017/`.

### 8.7 A Mac pass over the 10-17 UI changes (10-17)

Full `bun run perf` and `bun run test:feel` runs on the M2 (60 Hz, so a
one-frame budget is 24.7 ms) after the day's UI work: the unified Home
(Recent, the destination and topic chips, the welcome card), Home as a
title bar icon, the sidebar order hold, the new preview text, the Tidy up
sheet, Juno images, toolbar placement, Compact by default, Slack links in
Juno and the lazy parts. The heavy lock was exclusive, but other agents'
lint, typecheck and git runs kept the load at 2 to 13; a bare `<input>`
took 50 ms p95 to show a character at the worst of it. "First" is
`bb4fcb71` at load 5 to 13.6; "after" is the `mac-perf-feel` branch on
`551bf0b8`, a full run at load 2.4 to 11 and then one rerun of the misses
at load 2 to 5. ms, p95 unless marked.

| Metric | First | After | Budget |
| --- | --- | --- | --- |
| Warm start to shell / rows, median | 787.0 / 876.8 | **460.7 / 570.0** | 400 / 500 |
| Quick start, slowest of three | 7165 | 2894 | 5000 |
| Topic open, uncached | **358.2** | 55.3, then 36.1 | 50 |
| Topic open, cached / prefetched | 53.5 / 73.4 | 28.0 / 19.4 | 50 / 24.7 |
| Tab switch, mounted / unmounted | 49.4 / 74.4 | 17.4 / 19.5 | 24.7 / 50 |
| Peek open | 13.2 | 12.6 | 24.7 |
| Home open, quick / after idle | 18.3 / **269.0** | 16.1 / **209.5**, then 17.8 / 103.2 | 50 / 150 |
| New tab with Home | 28.3 | 19.5 | 24.7 |
| Media viewer open | 9.5 | 13.0 | 50 |
| Filter change | 45.6 | 23.8 | 50 |
| ⌘K open / keystroke to rows | 23.6 / 61.4 | 25.3 / 29.8 | 50 / 100 |
| Send / send in Main | 53.6 / 35.4 | 53.3 / 54.4, then 36.8 / 30.3 | 50 |
| Live update, sidebar / open thread | 16.1 / 74.1 | 14.3 / 21.0 | 50 |
| Row hover | 5.7 | 77.1 (one of nine), then 4.9 | 24.7 |
| Juno panel open / chat send to bubble | 21.8 / 23.6 | 25.0, then 22.1 / 21.3 | 24.7 |
| Juno's first bubble, fake model | 842.1 | 225.6 | 2500 |
| All topics open | did not measure | 29.0 | 50 |
| First opens in a second app (account, switcher, emoji, Settings) | 9.6, 12.1, 30.8, 17.6 | 12.8, 16.6, 23.3, 17.6 | 50 |
| Sidebar drag, work per frame | 20.7 | 6.6 | 8.3 |
| Sidebar scroll, continuous / held-clock | 5.5 / 4.4, 2 long frames | 5.1 / 5.0, 2 long frames, then 5.3 / 4.4 | 8.3 / 7 |
| All topics scroll | did not measure | 6.1 / 5.2, then 5.4 / 5.9 | 8.3 / 7 |
| Message scroll, prepend shift | 8.8 / 13.0, 5 long frames | 3.4 / 3.5, 0 px | 8.3 / 7, 0 px |
| Chat scroll | 9.0 / 8.7 | 4.5 / 4.1 | 8.3 / 7 |

Keystrokes stayed within one refresh interval of the same run's bare
input: composer 52.9, mention 38.9, emoji 39.7 and palette 39.4, against
73.3, 66.1, 69.6 and 56.1. Initial JS is 1,074.7 KB of 1,100 KB (1,047.0 on
8.6) and CSS 142.6 of 150. After scrolling the renderer's JS heap was
19.9 MB and its tab 93 MB.

The first run passed 12 of 26 perf scenarios, the full after run 17, and
the rerun 8 of the 9 that had missed. The feel suite went from 16 of 18
to 17 of 18.

- **Uncached topic open was load.** On a fresh app the engine answers
  `messages.list` and `topics.get` 2 to 23 ms after the press; the rest
  is the renderer drawing the header. Traced, one text run in the header
  took 4 to 15 ms to shape (`InlineNode::ShapeTextIncludingFirstLine`)
  in a layout of 13 dirty objects, and the commit waited up to 16 ms.
  Four of five opens took 32 to 35 ms in every run at load 6 or under.
  The 195 and 358 ms readings came at load 13 or more.
- **Home open after idle still misses in some runs.** Its five idle opens
  read 247.9, 77.4, 44.2, 269.0, 128.0 / 155.0, 126.3, 209.5, 21.8, 123.6
  / 69.7, 63.3, 87.8, 103.2, 17.1 ms in three runs. None waited on the
  engine. Traced, the slow ones do the same work as a quick open
  (mounting Home, React's `focus` of the composer forcing the layout,
  11 ms; React's `initInput`, 8.6 ms) several times slower. Under load 19
  the five read 37 to 77 ms. This is the clock after idle again (8.5). The
  150 ms budget is unchanged.
- **Warm start missed.** Most of it is Electron starting the renderer
  (process start to navigation 301 to 418 ms in the quiet rerun); Juno's
  renderer added 83 to 160 ms to the shell and 182 to 299 ms to the rows.
  On 10-16 navigation took 308 to 335 ms. Whether today's merges added the
  rest, or the load did, needs an A/B of the two builds on an idle Mac.
  The A/B is in 8.8: main did not regress, and the 570 ms was load.
- **All topics did not measure (test fixed).** Since `6f971705` All
  topics is an icon button in the sidebar title bar, and the scenario
  pressed 40 px from its left edge, outside it. It now presses the
  button's centre. Its first full run had one frame with 463 dirty
  layout objects against the 256 ceiling; the traced rerun's most was
  125.
- **Contention was misreported (test fixed).** Since installs link from
  the shared bun run store, the Electron helpers of the run's own app were
  printed as another checkout's. A checkout is now named by the app path
  in the process's arguments.
- **The palette opened without its rows (fixed).** ⌘K drew the search
  field alone for a frame, then grew to 459 px when the Frequent rows'
  first answer came (`palette-open` #4 to #5). Nothing kept that query
  warm. `Palette.tsx` now subscribes to it on idle, with the chunk, for
  the life of the window: one query per change to the conversations. The
  Recent rows (`searchAtom('')`, six topics) were still cold: the open
  palette draws its list once both have answered, so on the laptop's
  feel run (10-26) it opened empty in 7 of 7 tries. They are now
  subscribed on idle beside the Frequent rows.
- **Not reproduced.** Sidebar scroll's long frames (50 to 409 ms with no
  script and no blocking time) passed on the rerun, as in 8.6.

The feel findings and frames are in
`docs/reviews/mac-perf-feel-1017/feel-review.md`.

### 8.8 Warm start A/B and where the start goes (10-17)

The two builds of 8.7 side by side: `8c501ca8` (that morning's green) and
main at `89111e14`, each built in its own detached worktree and launched by
the `launch warm start` scenario, alternated over four rounds in one
exclusive run (20 measured launches each, load 2.3 to 9.7). ms.

| Metric | `8c501ca8` | main `89111e14` | Budget |
| --- | --- | --- | --- |
| Warm start to shell, median / p95 | 414.3 / 636.1 | **384.2 / 430.2** | 400 median |
| Warm start to rows, median / p95 | 505.4 / 760.8 | **473.2 / 516.1** | 500 median |
| Launch to focused composer, median / p95 | 528.3 / 761.4 | 494.3 / 531.4 | |
| Main to renderer process / navigation, median | 233 / 314.5 | 211.5 / 284 | |
| From navigation: bundle run, shell, snapshot, rows, median | +71, +98, +141, +179.5 | +68.5, +96, +143.5, +186.5 | |

Main did not regress, though its initial JS grew from 996.7 to 1,077.7 KB.
Both builds pass on a quiet Mac; the 8.7 reading was load.

A bare Electron app with the same binary and the same window settings
(sandbox, a preload, hidden until `ready-to-show`), 15 launches: main's
script runs at 110 ms, `ready` at 153, the `BrowserWindow` constructor takes
82, the renderer process starts at 224, navigation at 238 and the first
paint at 297 (medians; p95 of the paint 319 to 351). Juno's main reaches
the same steps at about 140 (its bundle loaded), 185 (`ready`), 192 (the
window asked for) and 285 (navigation); its window constructor also takes
82 to 100 ms. So Juno adds about 45 ms before navigation: main's bundle
has loaded about 30 ms after the bare app's script starts (10-15 measured 9
ms of that as main's own module load; the rest was not split), and
`serveAppScheme` takes 7 to 9 ms, which is Electron's `protocol.handle`
(6.6 to 7.8 ms in the bare app too). After navigation, a
startup trace and the engine's messages showed:

- The bundle comes from the V8 code cache (1.1 MB consumed, 2.3 ms) and
  its top level runs in about 20 ms; `juno.start` is at +63 to +72.
- The shell has painted by +88 to +96.
- The page sends `topics.list` at +67. The engine answers
  `session.status` at +76, and `topics.list` at +100: about 30 ms of SQL,
  shaping 300 rows and encoding a 220 KB snapshot. It is not waiting on
  other work. The snapshot lands at +111 to +124.
- The rows paint 42 to 46 ms after the snapshot.

Tried, measured and not kept:

- Node's compile cache for the engine (`NODE_COMPILE_CACHE` on the fork):
  engine ready at 316 against 323 ms, rows 472.5 against 473.6 ms median,
  20 launches each. No change. Its CPU in an e2e launch did not change either:
  0.86 to 0.98 CPU-s with it and without (10-26, laptop, 12 launches each).
- Registering IPC after the window: the time before the window is
  `protocol.handle`, not IPC, so nothing moved.
- Waiting without polling in the scenario: after a 2 s idle gap the CPU
  clocks down (7.3) and every step, Electron's included, took about twice
  as long. The scenario keeps polling.

Not done yet, each about 10 ms and below what this Mac resolves while
other agents run: a smaller first sidebar window (40 rows instead of 300;
10 ms on 10-15), which would cut the engine's first answer, the transfer
and the decode; and serving the first `juno://` request without loading
Node's `Response` on the critical path (about 8 ms in the bare app).

The budgets stay. Electron alone paints its first frame at about 300 ms,
which leaves 100 ms for the shell and 200 ms for the rows, and main uses
about 85 to 100 and 175 to 190.

The scenario now logs main's own steps (`src/main/startupMarks.ts`, read
from `globalThis.junoStartupMarks` under `JUNO_E2E`). `JUNO_E2E_STARTUP_TRACE=<file>` writes a
Chromium trace of the start, renderer and engine included, with JS samples
and the Juno marks. Tracing starts a few tens of ms after `ready` and slows
the start, so it shows where the time goes, not how long the start takes.

### 8.9 Milestone review of the 10-17 and 10-18 merges (10-18)

A full `bun run perf` on the M2 (60 Hz, so a one-frame budget is 24.7 ms) at main `627f74b1`, release 0.1.3: the Juno page switcher and Activity, memory notes with an outline in every prompt, the learning pass, tool approvals with their click run, Home ready early, the selection toolbar and Ask Juno, the text menu, lazy review sheets, English-only locale packs. The exclusive lock was held, load 1.8 to 4.6. The misses were run again, and warm start and mention typing were run alternated with a build of `89111e14` (the 10-17 A/B's main, 8.8) in its own worktree. "10-17" is the last recorded number (8.7's after run; warm start from 8.8). ms, p95 unless marked.

| Metric | 10-17 | 10-18 | Budget | Verdict |
| --- | --- | --- | --- | --- |
| Warm start to shell / rows, median | 384.2 / 473.2 | 447.9 / 565.2 in the full run; 360.2 / 456.1 over 20 alternated launches, `89111e14` 365.1 / 478.7 | 400 / 500 | No regression: the first reading was the machine |
| Launch to focused composer, median | 494.3 | 474.8; `89111e14` 509.1 | | |
| Quick start, slowest of three | 2894 | 2869 | 5000 | Pass |
| Topic open, uncached | 36.1 | 33.7 | 50 | Pass |
| Topic open, cached / prefetched | 28.0 / 19.4 | 18.0 / 19.9 | 50 / 24.7 | Pass |
| Tab switch, mounted / unmounted | 17.4 / 19.5 | 25.0, then 17.8 / 17.9 | 24.7 / 50 | Noise: one slow sample, passed on the rerun |
| Peek open | 12.6 | 13.1 | 24.7 | Pass |
| Home open, quick / after idle | 17.8 / 103.2 | 19.6 / **347.5**, then 16.3 / 23.7 | 50 / 150 | The clock after idle (8.5); passed on the rerun |
| New tab with Home | 19.5 | 18.2 | 24.7 | Pass |
| Media viewer open | 13.0 | 27.8 | 50 | Pass; 14 of 16 opens under 5.1 |
| Filter change | 23.8 | 21.6 | 50 | Pass |
| ⌘K open / keystroke to rows | 25.3 / 29.8 | 20.1 / 39.0 | 50 / 100 | Pass |
| Send / send in Main | 36.8 / 30.3 | 35.5 / 46.7 | 50 | Pass |
| Live update, sidebar / open thread | 14.3 / 21.0 | 18.1 / 29.1 | 50 | Pass |
| Row hover | 4.9 | 7.9 | 24.7 | Pass |
| Juno panel open / chat send to bubble | 22.1 / 21.3 | 21.9 / 22.4 | 24.7 | Pass |
| Juno's first bubble, fake model | 225.6 | 161.6 | 2500 | Pass |
| Switch to Activity in the panel | not measured | 22.5 | 50 | Pass |
| All topics open | 29.0 | 26.1, then 23.6 | 50 | Pass |
| First opens in a second app (account, switcher, emoji, Settings) | 12.8, 16.6, 23.3, 17.6 | 18.5, 16.3, 30.3, 17.5 | 50 | Pass |
| Sidebar drag, work per frame | 6.6 | 7.0 | 8.3 | Pass |
| Sidebar scroll, continuous / held-clock | 5.3 / 4.4 | 5.4 / 4.3 | 8.3 / 7 | Pass |
| All topics scroll | 5.4 / 5.9 | 5.7 / 4.7 and one long frame, then 5.8 / 4.8 | 8.3 / 7 | The long frame (55 ms, no script) is the first-step shape of 8.5; passed on the rerun |
| Message scroll, prepend shift | 3.4 / 3.5, 0 px | 7.0 / 3.3, 0 px | 8.3 / 7, 0 px | Pass; 6.4 on 8.6 |
| Chat scroll | 4.5 / 4.1 | 5.4 / 4.4 | 8.3 / 7 | Pass |
| Mention typing, character presented against the bare input + one refresh | 38.9 against 66.1 | **62.6 against 55.8, 59.1 against 56.8**, then 52.4, 51.7, 53.3 within | one refresh over the control | Borderline, see below |
| Composer, palette, emoji typing | 52.9, 39.4, 39.7 | 37.3, 38.9, 43.8 | one refresh over the control | Pass |
| Initial JS / CSS | 1,054.6 / 143.3 KB | 1,058.5 / 144.4 KB | 1,100 / 150 KB | Pass |
| Renderer JS heap after scrolling | 19.9 MB | 20.4 MB | 120 MB | Pass |

- **Mention typing.** Alternated three times with `89111e14`, every run passed, but main's p95 was higher in each pair: 52.4, 51.7 and 53.3 ms against 38.7, 49.3 and 43.5 ms. Main's input to its frame was 15.6 ms p95, inside the frame; the extra is after it, where more of main's keystrokes wait one more refresh (frame to presentation p95 about 40 ms against 34 to 39). Traced with `JUNO_TRACE_SKIA`, the GPU raster per presented frame rose from 0.85 to 0.91 ms and the renderer's paint and layout were the same, which does not explain a refresh. The traced pair also came out the other way round (51.9 base, 43.2 main). No cause found and nothing to fix yet; if it fails again, trace the suggestion list's frames first, as 7.1 says. Followed up in 8.10: over 200 keystrokes per build the difference is 1 to 2 ms, and nothing of ours explains it.
- **Renderer working set.** The scroll scenario printed 126 MB for the tab against 93 MB on 10-17, and 139 against 102 MB alternated with `89111e14`, while the JS heap (20.4 against 20.1 MB) and the DOM (9,530 against 9,514 elements) stayed the same. A first-parent bisect on that number read 164 to 215 MB at the commits in between, above both ends, so the working set follows the Mac's memory pressure, not the code (8, "`app.getAppMetrics()` reports working set"). It was stopped. The memory budget is private memory, which this scenario did not print; it does since 8.10.

**Agent side.** On the fake model, which answers at once, so these are the agent's own time. Three remote runs; each p95 is of 15 or 10 samples, so one slow sample sets it:

| Measure | 10-18 |
| --- | --- |
| A normal message: send to the model request, median / p95 | 5.0 to 5.3 / 5.8 to 17.7 ms |
| Send to the first bubble | 5.1 to 5.4 / 6.0 to 17.9 ms |
| Request size on a chat with history and memory (system text, messages and tools) | 24,492 characters median |
| A connection call approved on its card: click to the click run started | 1.7 to 1.8 / 3.5 to 3.8 ms |
| Click to the run's model request / first bubble | 6.7 to 6.8 / 8.3 to 17.4 ms, 6.8 to 7.0 / 8.5 to 17.6 ms |
| Its request size, with the call's result | 26,792 characters median |
| Cache hit over eight requests with memory writes: no outline / the outline / the outline first | 0.988 / 0.980 / 0.858 |

The outline costs about 57 tokens a request and keeps the cached prefix: a memory write changes nothing before the recent messages. In the app the first bubble against the fake OpenRouter is 130.5 ms median, so almost all of it is the fake's stream and the renderer, not the agent. The times come from `packages/agent/test/turn-timing.perf.ts` (gated by `bun run perf --unit` at 100 ms p95 for both firsts), the cache numbers from a measurement test since deleted (the unit suite keeps the invariant behind them: the outline is fixed within a run and sits after the summary), both on a remote machine. Writing the test found one behaviour worth knowing: an approval whose card settles while Juno's previous run is still going steers that run instead of starting a click run, as any input does.

No regression found here needed a fix. Logs are under `.juno-status/perf-review-1018/`.

### 8.10 Follow-ups to the 10-18 review (10-18)

Four items from 8.9, decided by the owner. Measured on the M2 (60 Hz) under the exclusive lock, load 2 to 4; `89111e14` is the 10-17 build, built in its own worktree and alternated with this branch.

**The selection chip.** With the Juno panel open, every `selectionchange` re-read the selection: `getRangeAt`, `Selection.toString()` of all of it, an `offsetParent` read to find the visible topic and a query of every row for the count, each of which can lay out the page, then a state change that re-rendered the whole panel chat. A drag fires about 22 of them. Now (`containers/juno/topicContext.ts`):

- The events only ask for a read in the next frame, so there is at most one a frame.
- The read builds the range from the selection's anchor and focus, not `getRangeAt`, which makes the selection canonical and lays out first (2.6 of 6.8 ms of the read in a profile). It does nothing when the ends have not moved, finds the sender and whether the topic is on screen (the one layout read) only when the row the selection starts in changes, and counts the messages by position only when the row it ends in changes.
- The chip keeps the first 420 characters of the selected message text (enough for its snippet and its 400-character tooltip), read by walking the selection's text nodes with no layout and kept while the selection only grows. The whole text is read from the kept range once, when the message is sent.
- The held selection is a small store that only the chip's line subscribes to, so a drag re-renders the chip, not the chat.

The sent text is now the messages' own text: a line break between blocks and a blank line between messages, without the sender names and times between them that `Selection.toString()` gave. The selection still carries its first sender, `ts` and message count.

The new scenario `drag a selection down the 300-message thread with the Juno panel open, while its chip follows` (`perf.spec.ts`, `e2e/perfSelection.ts`) drags from a message three screens up, one move a frame, to the list's bottom edge and past it while the list scrolls under the selection, first with the panel closed for comparison, then open. It gates the open drag's main-thread work per frame at 8.3 ms p95 with no long animation frame, and checks the chip names the messages. Three alternated pairs, ms per drag:

| | Before | After |
| --- | --- | --- |
| `selectionchange` listeners, panel open (closed: 0.7 to 1.3) | 14.3 to 26.0, longest 1.7 to 3.3 | 1.1 to 1.2, longest 0.15 |
| The chip's read, timed in the page | in the listeners | 7.1 over 23 reads, longest 1.3 |
| Frame work p95, panel open | 4.6 to 7.7 | 7.0 to 7.5 |

Frame work p95 did not move outside its noise: drawing the selection is most of each frame (about 400 to 670 ms of main-thread work per drag either way). In one profiled drag the chip's script was about the same before and after (6.0 ms of listener and 7.1 ms of React, against 9.7 ms of reading and 3.9 ms of React); what went is the layout the old listener forced on every event and the copy of the whole text. The largest script cost in the drag is not the chip but the message rows' `placeToolbar`, 13 to 21 ms per drag whether or not the panel is open, two rect reads on every pointer move while the hovered row scrolls under the pointer. Skipping it during a drag would leave the hover toolbar where it was until the button is up; that is a look decision, so it is left as is.

**A drag selection that started from a text field selected nothing (fixed).** The new scenario failed in 2 of 3 runs before the chip change: with the panel's composer focused, the press on message text moved focus out of the field, and the caret clearer of 8.4 removed the caret the press had placed on the next frame, before the pointer moved, so the drag had no start. `clearCaretsLeftBehind` now waits while a mouse button is down and looks again on release. `juno-agent/panel.spec.ts` drags over a message with the panel's field focused, resting 100 ms after the press: it failed before and passes after; the scenario then passed 3 of 3.

**Mention typing.** Five more alternated pairs, untraced, 200 keystrokes per build: input to character presented 33.7 ms median, 50.0 ms p95 on this branch against 32.0 and 48.7 ms on `89111e14`; input to its frame 5.6 and 14.7 ms against 5.0 and 13.9 ms; the bare input 31.1 / 53.4 against 31.6 / 39.4. All ten runs passed. Unminified profiles put this branch's extra script at about 0.1 ms a keystroke (`LoadedComposer` and `useMentionRows`, which now also holds the bare "@" answer, 10-18 decision `warm-bare-mention`), which cannot add a refresh. Traced, the order came out the other way again (main 39.9 and 39.4 ms p95, `89111e14` 60.3 and 41.2 ms). So the gap of 8.9 was noise in a gate that compares two 40-sample p95s: a run fails when two of the composer's 40 keystrokes wait one more refresh while the bare input's run was quiet. The scenario now also prints each key of the query (no key stands out: the "@" that opens the list had the highest median in three of five runs, and the slow tail is spread over all four keys). Nothing to fix in the app.

**Private memory.** The scroll and memory scenario now prints each process's private memory beside its working set and holds main, the renderer and the engine to their budgets (section 1). macOS gives Electron's `private` as the physical footprint: 107,409 KB from `process.getProcessMemoryInfo()` against a `footprint` of 105 MB in the same process, so the test reads it with `footprint -f bytes` by pid, with no hook in the app. The engine is listed by `getAppMetrics()` as `node.mojom.NodeService`, not by its service name, and is found by `junoTest.enginePid`. Four runs:

| Process | Private | Working set | Budget |
| --- | --- | --- | --- |
| Main | 51 to 53 MB | 86 to 102 MB | 80 MB |
| Renderer | 167 to 227 MB | 207 to 228 MB | 250 MB |
| Engine | 76 to 94 MB | 73 to 77 MB | 300 MB |
| GPU (no budget) | 97 to 107 MB | 51 to 57 MB | |

The renderer's JS heap stayed at 20.0 to 20.5 MB, so its 60 MB spread between runs is native memory (decoded images, rendering and the allocator's caches), and its worst run is 91 % of a budget meant for the heavier scenario of section 1 (20 topics opened, 50 tab switches, 2 minutes of scrolling), which did not exist yet; it does since 8.11, and the renderer misses it.

Logs are under `.juno-status/perf-followups-1018/`.

### 8.11 The hover toolbar in a drag selection, and the heavy memory scenario (10-18; the toolbar was removed 10-22)

Two items decided by the owner after 8.10. M2 (60 Hz), exclusive lock, load 2 to 4.

**No hover toolbar during a drag selection** (until the toolbar itself was removed with the message menu, 10-22; the measurements below are kept as found). Native apps keep hover controls out of the way while you select. From the moment a primary-button press on the message list moves 4 px until the button is up, `MessageList` marks the list `data-selecting` and sets `--row-hover-toolbar: none`, which a row's `:hover` reads for `--row-toolbar-display`. No row shows its toolbar, and pointer moves and `scrollend` do not place one. On release the row under the pointer places it and shows it. Keyboard focus still shows a row's toolbar (`:focus-visible` is unchanged), a press that does not move changes nothing, and nothing re-renders. `apps/gallery/hover-toolbar-drag.spec.ts` checks both. The selection drag scenario (8.10) now also reports the `pointermove` listeners, ms per drag:

| | Before | After |
| --- | --- | --- |
| `placeToolbar`, unminified profile, panel closed / open | 23.0 / 22.3 | 5.3 / 4.4 |
| `pointermove` listeners, trace, panel closed / open, three runs | 5.6 to 7.0 / 6.0 to 6.2 | 5.3 / 4.3 and 5.3 / 5.0; 11.5 / 12.5 in a slow run |
| Frame work p95, panel open | 3.0 to 3.5 | 2.9 and 3.1; 5.7 in the slow run |

What `placeToolbar` has left runs before the press, as the pointer moves to where the drag starts. The slow run had about twice the main-thread work everywhere (397 and 531 ms per drag against 188 to 287 ms in the others).

**The heavy memory scenario.** `memory after heavy use` (`perf.spec.ts`, `e2e/perfMemory.ts`) does on the large seed what section 1's memory budget assumes: 20 topics opened, each in its own tab; 50 tab switches; the Juno chat given 40 messages in a tab of its own; about two minutes of scrolling that moves between the sidebar, the next topic tab's messages and the chat, with the panel opened and closed beside the topic; then 30 s idle. It prints private memory after each part and gates main, the renderer and the engine against their budgets after the idle. The reading right after the scrolling counts garbage Chromium has not collected yet; the idle lets it collect, as it does once the owner stops to read.

| Process | After launch | Right after heavy use | After 30 s idle | Budget |
| --- | --- | --- | --- | --- |
| Main | 52 to 54 MB | 51 to 52 MB | 51 to 63 MB | 80 MB |
| Renderer | 149 to 177 MB | 437 to 524 MB | 265 to 294 MB | 300 MB (250 MB in the scroll and memory scenario) |
| Engine | 117 to 133 MB | 115 to 125 MB | 113 to 125 MB | 300 MB |

The renderer read 265, 268, 270 and 294 MB over four runs: 6 to 18 % over the 250 MB of the scroll and memory scenario, inside the 300 MB this scenario has (below). A Chromium memory-infra dump of the renderer at launch and after the idle, without a forced collection (`JUNO_MEMORY_DUMP=<prefix>`; `JUNO_MEMORY_PHASES=1` dumps after each part too, before and after a collection):

| Allocator | Launch | After 30 s idle |
| --- | --- | --- |
| Oilpan (`blink_gc`: DOM, style, layout) | 54 MB, 40 live | 103 MB, 30 live |
| malloc | 46 MB, 32 live | 80 MB, 53 live |
| PartitionAlloc | 9 MB | 15 MB |
| V8 | 56 MB | 31 MB |

What holds the extra memory is the allocators' free pages after a peak, most of all Oilpan's (about 70 MB resident and free), then about 21 MB more of live malloc. None of the suspects named for this is large: images hold 0.5 MB in the resource cache and nothing decoded or discardable; the StyleX sheet is 145 KB of CSS; the unmounted tabs' state is inside a 28 MB JS heap; and the tiles (75 to 180 MB in `cc/tile_memory`) live in the GPU process's shared images (GPU process 107 to 206 MB, no budget). The peak is rendering garbage: during the scrolling part Oilpan reached 323 MB before a collection and 112 MB after it, because JavaScript allocates little while scrolling and the collector runs late. Run alone for two minutes, the sidebar's scroll left 325 to 381 MB in Oilpan, the chat's 300 MB, a 10-message topic's 112 MB; the garbage grows with the rows that pass under the pointer.

Tried, measured and not kept:

| Change | What it did |
| --- | --- |
| No hover toolbar elements in message rows | Oilpan after scrolling 108 against 110 MB; nothing |
| Row hover by ancestor selectors (`stylex.when.ancestor`) instead of inherited custom properties, sidebar | Oilpan before a collection 361 and 384 MB against 325 to 381; nothing |
| Rows hoverable, their contents not, sidebar | 321 and 357 MB; nothing |
| No row hover in any list while scrolling (`pointer-events: none` on rows) | sidebar alone 191 and 242 MB against 325 to 381; whole scenario after idle 255 and 261 MB against 265 to 294 |
| Three mounted tabs instead of five | 271 and 276 MB after idle; nothing |

So Chromium's hover update as the wheel slides rows under a still pointer is about a third of the scrolling garbage, but taking it away saves only about 10 MB once the page is idle, and the rows would not highlight while the wheel turns. No app-level holder of the 15 to 44 MB over 250 MB was found.

**Budget (owner, 10-18).** The scroll and memory scenario keeps 250 MB for the renderer. This scenario has its own, 300 MB, read after the 30 s idle, with main's 80 MB and the engine's 300 MB unchanged (`HEAVY_MEMORY_BUDGETS`). The reasoning: what this scenario adds over 250 MB is freed pages Chromium's allocators keep after the scrolling peak (Oilpan about 70 MB resident and free, against 40 MB live at launch), not memory the app holds, and none of the five fixes above removed it; a gate that cannot pass would only be ignored. The 300 MB leaves 6 MB over the highest reading, 294 MB, so a real regression still fails it. Turning row hover off while scrolling and asking Chromium to purge memory were both declined. When the first `stylex.when` keys were tried, they were written as constants outside `stylex.create`; the compiler replaces them only inside it, and elsewhere they run in the bundle and throw at load, which left the app on a blank window (stylex skill).

Logs and dumps are under `.juno-status/perf-memory-1018/`.

### 8.12 Every process at rest, and the send workers' spin (10-18)

The owner saw a "Juno Helper" at 100 % of a core on his other Mac with the app only open (0.1.3 or 0.1.4). Activity Monitor names every utility process "Juno Helper": the engine, the Juno agent and the network service; the renderer and the GPU process carry "(Renderer)" and "(GPU)".

**The cause.** The post worker (`engine/src/send/worker.ts`) and the edit, delete and reaction worker (`send/actionWorker.ts`) try only the first row of each channel in a pass; the rows behind it wait for it. Their next wake was the earliest due time over every row. When a channel's first row waited out a backoff (a post being looked up after a lost answer, a reaction refused with a temporary error) and a later row in that channel was due, the wait was 0 and the pass ran again at once, each time with a write transaction. The rows are in `user.db`, so the spin survived a relaunch, and a fresh sync never has them, which is why the fake seeds and a fresh sync of a real workspace stayed quiet. The wake now comes from each channel's first row only (`channelHeads`). `edit-retry-idle.perf.ts` builds the edit shape on the fake server. The two shapes measured 131 % and 111 % of a core before, under 3 % after.

**The real workspace, read-only.** `scripts/idle-live.ts` (development.md, the commands table) ran the engine on the cached session: a fresh sync went quiet after 282 s, then 2.1 % of a core over 180 s (the CPU profile was 99.6 % idle); a relaunch on the same cache with the AI jobs on the engine's fake model, 2.0 %. The built app on the same cache, with every Slack write refused in a local build, measured by `ps` CPU time over 3 minutes after the sync settled: main 0.1 to 0.4 %, window 0.3 to 0.5 %, GPU 0.3 to 0.7 %, network 0.0 %, engine 0.2 to 0.8 %; after a relaunch, the same within 0.3 %.

**Each state on the fake seeds.** `idle-cpu.spec.ts` with `JUNO_IDLE_WINDOW_MS=60000` on this Mac (M2, load 2), % of one core, the same before and after the fix (the fake seeds hold no unsent rows):

| State | Main | Window | Engine | Agent | Graphics | Network |
| --- | --- | --- | --- | --- | --- | --- |
| After a mention (default seed) | 0.8 | 0.7 | 0.5 | | 0.6 | 0.0 |
| First sync, syncing card shown | 0.9 | 1.4 | 1.0 | | 0.9 | 0.1 |
| Home (large seed) | 0.5 | 0.7 | 0.2 | 0.1 | 0.5 | 0.0 |
| A topic | 0.1 | 0.2 | 0.2 | 0.2 | 0.1 | 0.0 |
| Juno panel, 20 turns, after a reply | 0.4 | 1.5 | 0.2 | 0.5 | 0.6 | 0.0 |
| Activity in the panel | 0.4 | 0.4 | 0.2 | 0.4 | 0.2 | 0.0 |
| Juno tab, after a reply | 0.1 | 0.4 | 0.2 | 0.4 | 0.3 | 0.0 |
| Activity in a tab | 0.1 | 0.1 | 0.1 | 0.2 | 0.1 | 0.0 |
| Five tabs | 0.1 | 0.1 | 0.2 | 0.2 | 0.1 | 0.0 |
| Window minimized | 0.1 | 0.1 | 0.2 | 0.1 | 0.0 | 0.0 |
| Window hidden | 0.1 | 0.1 | 0.1 | 0.1 | 0.0 | 0.0 |

No application animation runs at rest; a focused text field keeps its native caret. The one endless application animation, the chat's status dots, shows only while a run is active and stops under reduced motion; the topic art's fade and the cards' entrances run once. The budgets in section 1 leave room over these for a slower machine. The renderer's 1.5 % beside a long chat is the highest; it is under budget and was not traced.

**Platform gates.** The Mac's Window budget is 3% of one core when a visible,
focused text field has its native blinking caret, and 2% otherwise. Graphics
stays at 2%. The test reads actual document focus and the editable element,
so this applies to Home and focused topic or chat composers, but not a
hidden or minimized window. It measures a topic both before and after
focusing its composer. Every state settles for 10 seconds, then measures
for 60 seconds by default, as the original helper CPU measurements did.
`JUNO_IDLE_WINDOW_MS` overrides the measurement window.

These limits use native rendering and run only in the `@mac` walk, by hand.
The laptop renders in software, and with 60-second windows shared-machine
scheduling caused three false failures on 10-18 (2.45–3.4%). Its walk holds
every process to 5% over 4-second windows instead: on 10-26 every process read
0 to 1.2% at rest there, and the engine 3.7% while the first sync waited. That
still fails a spin of any size that matters, such as the 100% helper. The fine
budgets run only by hand on the Mac, through the heavy-job lock, with
`bun run test:desktop idle-cpu.spec.ts --grep @mac`, or in
`bun run verify:main --with-mac`.

**Home's short-window miss, investigated on 10-18.** The default 20-second
Mac gate read Window 2.2% in the diagnostics review and 2.3% in a new
minified build of `ab35e024`. The latter run was stopped after reproducing
the failure, before completing its three requested repetitions.

A Chromium trace started before sync settled, without the CPU profiler,
captured 30 seconds idle on Home and then 30 seconds on a topic. Both ran
through `bun run test:desktop` and its machine-wide heavy lock. Window read
1.5% on Home and 0.2% on the topic. Home's trace names two V8 "memory reducer"
collections, starting 8.9 and 17.7 seconds into the idle window, including
parallel marking on renderer worker threads. The first reduced the JS heap
from 48.5 MB to 21.9 MB. The topic window had no major collection.

Home had no running CSS animation, no JavaScript animation-frame callback,
one minute-boundary timer and one layout in those 30 seconds. Its 61 main
frames match the focused textarea's native caret blinking twice a second.
The topic had one main frame and one layout. Source inspection confirms
that `nowAtom` wakes at minute boundaries and the asks stream emits only
changed values. The trace supports deferred garbage collection as the
extra work in this first idle window, but does not establish an application
loop to remove. The owner classified this as load cleanup, not a product
bug. The measurement now allows 10 seconds to settle and averages 60
seconds so load cleanup does not dominate a short idle sample. The 3%
Window budget for a focused text field allows its normal native caret.
The application, caret and garbage collector are unchanged.

An earlier capture started the CPU profiler after sync and then measured
CPU after the trace. That read 0.5% on Home, but is not a comparable
before/after result. Trace startup and the extra wait change the measured
window. Local evidence is in `/Volumes/AgentWork/home-idle-evidence/`:
`baseline-three.log`, `early.log`, and `early/*-idle-sample.trace.json`.
The full early traces and temporary probes are there too. The probes were
removed from the worktree after capture.

**Engine's minimized-window miss, investigated on 10-18.** The unprofiled
reports were 3.1% on home-idle and 3.4% on mention-person-memory. The gate
can measure a scheduled sync pass as idle CPU. A diagnostic replay traced
the minimized spike to this pass, rather than a loop caused by minimizing.
With 10 seconds settling and 60 seconds per state,
the large-seed sequence reaches minimized near the discovery sweep, ten
minutes after the first sync ends. The same interval and scheduling loop
already exist in `05ea2ef3` (`sync/src/config.ts`, `run/boot.ts`). The sweep
continues while minimized so Slack state and notifications stay current.

One diagnostic replay of the full sequence at `af1e7b30`, with an unminified
build, the engine's inspector CPU profiler and temporary timer/SQL counters,
read 0.2–0.3% engine CPU in the preceding states and 5.9% while minimized.
That busy minute made 121 successful HTTP reads: one `client.counts`, 114
`subscriptions.thread.getView`, one search, one history and four replies;
none failed. It ran 60,388 SQL statements, including the thread merges and
re-indexing. The timer counters include one 600,000 ms sweep wake and 248
30 ms invalidation timers. The CPU profile attributes 585 ms of sampled
self time to SQLite `all`, with only 118 ms in garbage collection. Profiling
and counter overhead make the 5.9% unsuitable as a comparison with the
unprofiled failures, but the requests and database work establish that this
was a busy sync window.

An earlier replay that minimized before ten minutes showed sparse SQL
work and no worker loop. Its minute held six websocket-ping timers, the normal
minute timers, and 239 wakes from the process logger's empty-buffer flush.
Automated's grouping window and the Slack schedule debounce did not keep
waking without input. As in the existing test, background AI jobs were
disabled; Automated rules and Slack scheduling remained enabled. The
logger now arms one 250 ms timeout when a line
arrives and leaves no timer for an empty buffer. This removes needless
wakes in main, engine and agent; it does not account for the sweep's CPU.
A separate probe of the revised logger counted zero empty-buffer timer
wakes over three seconds, then one timer wake that persisted a new line.

The large-seed idle gate now prints and annotates a sample containing a
successful discovery sweep, waits for sync to finish and settles again,
then takes one replacement window. The replacement must contain no Slack
calls and must meet every existing CPU limit, including the engine's 3%.
A high reading alone gets no retry, failed Slack calls fail the test, and
continuing requests fail the replacement. The separate first-sync test
still measures the syncing card while a history call is held.

Final verification used minified builds without the probes. One full Mac
large-seed run (`bun run test:desktop idle-cpu.spec.ts --grep 'mac process budgets.*large seed'`)
passed, exit 0: engine 3.0% in the sweep window, 0.2% in the quiet minimized
replacement and 0.2% hidden, each over 60 seconds. `bun run affected` passed,
exit 0: local typechecking and lint, then 21 selected desktop tests on
Linux. Its sweep window read 3.5%, the quiet minimized replacement 0.0%
rounded, and hidden 0.1%. These are single runs on each platform, not a
speedup distribution: the change separates due sync work from idle rather
than making that work faster. The 3% budget is unchanged.

Evidence, profiles and temporary probes are in
`/Volumes/AgentWork/engine-idle-evidence/`: `full-profile.log`,
`minimized.cpuprofile`, `activity.json`, the earlier `early-*` captures,
`mac-final.log`, `affected.log` and `log-timers.log`.
The probes were removed from the worktree before verification.

**Scheduled sweep database work, reduced on 10-18.** The trace above read
1,140 followed thread views in 114 ten-row `getView` pages. They belonged to
295 of the seed's 300 conversations. The pass reads followed threads with
activity in the seven-day quiet window, plus the page that crosses its
boundary, so it can repair a follow, read mark or reply missed by realtime
events. The other seven reads in that sample were counts, discovery and the
few conversations or threads whose cursors had moved.

The 60,388 statements were about 53 per thread view. They included 7,862
single-message reads, 5,778 topic-read reads, 5,778 outbox reads, 3,493
topic-index reads, 3,457 thread-message reads, 3,385 user reads, 3,357 reply
counts and 2,317 cursor reads. The pass also opened and committed 3,462
transactions. Unchanged views still rewrote merge, reaction, read, follow,
cursor and index rows.

The revised follow pass compares the fetched pages with six batched store
reads; its hourly full-window scan takes one store snapshot instead of six
reads per page. An unchanged view advances only an in-memory follow
observation fence. It does not rename users, rewrite rows or invalidate
queries. A changed or uncertain view still uses the normal merge path,
including the request-time guard that stops an older page from undoing a
realtime follow change. The history part of the sweep compares
`client.counts` with all stored channel ranges in one query and skips
channels whose latest timestamp did not move. The periodic cursor remains
in memory instead of rewriting the boot record.

A counter-only replay of the same 114-page full follow pass ran 1,792
statements, 33.7 times fewer than the baseline, and opened 150 transactions.
That pass is hourly in production. The 60,388-statement and 3.0%-CPU baseline
was not an ordinary production sweep: the fake-server desktop forced the
hourly full pass into every ten-minute catch-up. The fake now keeps the
production cadence; focused sync tests still set `followPassMillis: 0` when
they need every cycle to reconcile follows.

The real production-shaped ten-minute sweep uses incremental counts, one
`getView` page back to `lastSyncAt`, history only for a conversation whose
latest timestamp moved, and newest-first discovery. The incremental page
keeps missed follow, unfollow and thread-read changes at ten-minute freshness;
the hourly pass still repairs the whole quiet window. Search overlaps the
cursor by five minutes so Slack indexing delay and clock skew cannot strand
an unfollowed reply. Two batched reads discard overlap matches whose message
and root counters already equal the store.

One large-seed minute containing exactly one production-shaped sweep on
`origin/main` made three Slack reads (counts, one `getView`, one search) and
ran 1,722 SQL statements. The revised sweep made four reads (the same counts
and `getView`, plus two search pages for the overlap) and 79 statements,
21.8 times fewer. The incremental `getView` is one Slack call and six batched
certification statements when unchanged, so retaining its freshness is
cheap. Both are single counter runs with an unpaced fake and the production
ten-minute/hourly split; the sweep timer alone was shortened to put one pass
inside the measured minute. Their whole-process CPU is not a product measure
because the fake Slack server runs in that same Node process and generated
the search results there. The desktop idle gate measures the Engine utility
process separately.

Matched minified Mac desktop runs used the production cadence on both
`origin/main` and the revised branch. In the minimized 60-second window that
reported the scheduled counts, incremental `getView`, discovery, history and
reply reads, Engine CPU was 0.4% before and 0.3% after. That 0.1-point change
is near the sampler's resolution, so the useful result is that both are below
the 1% target, not a claimed CPU speedup. The revised run then measured 0.2%
minimized and 0.2% hidden. Both focused Mac tests passed with exit 0.

A fake-server behavior test observes SQLite from a second connection: a
sweep with no server change leaves `PRAGMA data_version` unchanged, then a
silently posted reply is present after the next sweep. This tests no writes
and missed-event repair without fixing a statement count in the test.

The statement counter records every SQLite statement by normalized SQL text.
It was installed only for the measured minute and removed afterwards. The
baseline evidence is `/Volumes/AgentWork/engine-idle-evidence/activity.json`.
An earlier full-desktop revised trace is
`/Volumes/AgentWork/sync-sweep-after/activity.json`; the isolated 1,792- and
production-shaped 1,722- and 79-statement probes printed their results and
were then removed. These are single runs, not a timing distribution.

**Seeing it next time.** Settings › About › Diagnostics lists each process with Juno's name and Electron's type, its CPU over the last few seconds and its memory, and **Copy diagnostics** puts a plain-text report on the clipboard (SPEC 14). Main samples every 15 s and logs one line when a process stays above 30 % of a core for 2 minutes while the window has no input and no sync runs, with the window's state and the view; the report repeats the last such line.

### Engine speed measurements (2026-10-15)

Five alternating baseline/revised runs on the shared Apple M2, through the
exclusive `bun run bench:engine -t '^topics.list on the large seed'` command.
Each run used 300 channels and sampled 50 injected message updates after
boot. Both sides used the corrected harness: wait for the injected message
itself, and construct a fresh cache for each uncached isolated query. The
baseline is query.ts at `1b88efc7`; other code and the harness were held fixed.

| Measurement | Before | After |
| --- | --- | --- |
| Event query p95, five runs (ms) | 4.17, 3.41, 4.04, 3.95, 11.16 | 3.01, 3.18, 4.26, 3.94, 5.26 |
| Median of those p95 readings (ms) | 4.04 | 3.94 |
| Median warm isolated query (median of runs, ms) | 2.14 | 2.11 |
| Row snapshot / refs / largest delta (bytes) | 175834 / 91760 / 520 | 175834 / 91760 / 520 |

This is a small improvement with overlapping ranges, not a reliable large
speedup. Four revised runs met 5 ms; one did not. The backlog stays open.
The existing cache already reused shaped rows. This pass avoids collecting
unchanged user ids, retains the people map while its source holds, and uses
an array instead of a temporary row-keyed map. Source columns are still
compared after the version check: deleting and recreating an index row can
reuse its version.

Three preliminary remote pairs on 4-vCPU machines gave before p95 readings
of 5.13, 3.77, 5.54 ms and after readings of 4.54, 5.36, 8.31 ms. They do not
establish an improvement; host variation and event-loop contention dominate
that comparison. Remaining remote repeats were cancelled at the shared
capacity limit. The Mac runs above provide the complete five-pair series.

The production-paced large fake cold boot (`bun run remote bench:sync`, one
4-vCPU machine per run) reached `live` in 579.264 s before and 459.310 s
after, a 119.954 s reduction. That run spaced history and replies 1,200 ms apart; they were later set back to 1,500 ms per method to leave room for the official client on the shared token, so part of this gain (about 78 s by the earlier projection) does not apply. Sidebar setup reached catch-up in 25.749 s
and 16.537 s respectively. Both runs made 471 Web API calls: 300 history,
113 getView, 50 replies, three discovery search calls and five setup calls;
they stored the same 6,179 messages, 1,525 roots, 3,478 replies, 300 ranges
and 2,574 reactions. Neither reported rate-limit or decode failures.

This pair measures paced waiting, not throughput: the revised remote run
averaged 2% CPU busy on four cores. History call time fell from 444.909 to
357.526 s and replies from 74.740 to 58.682 s. Unpublished getView calls
can now overlap independently with other methods. The seed and budgets
were unchanged; discovery metadata saves a separate root lookup in the
warm-boot test, but did not lower this cold-boot call total.

These are single paced runs, not a repeated latency distribution. The
baseline recorded `live` before its read-only guard rejected the later
emoji read; the guard now permits `emojis/list`. That correction does not
change the timed boot. Aggregate logs are in
`.remote/20261015T171747-6397/run.log` and
`.remote/20261015T182935-62134/run.log`. No live Slack was accessed.

The final full engine benchmark passed all five cases after isolated reads
were changed to stop the engine before opening a second store. Waiting for
a sync cycle alone could time out on this seed, and opening a second writer
while the engine was active could fail with `SQLITE_BUSY`. Event timings
still run against the active engine before that stop.

That full run had reported one-minute loads of 7.3–14.5 and missed several
reported budgets: sidebar event p95 was 17.80 ms and All topics warm p95
31.31 ms. Messages live-query p95 was 4.54 ms; search p95 was 8.62 ms while
10,000 backfill messages landed. The command was not in strict timing mode;
its pass confirms the scenarios and assertions, not every timing budget.
The log is `/tmp/juno-speed-engine-bench-final-2.log`.

Final verification on the merged branch: the focused engine run passed 72
tests in seven files; the engine benchmark passed five cases. `bun run affected`
passed typechecking, the 22 Slack tests, 34 schema tests, specs, 97 gallery
tests and 261 desktop tests (34 Linux skips), plus health and pool checks.
Its broad unit run stopped in the unchanged agent chat-cache benchmark:
one of five p95 readings was 50.105 ms against the strict 50 ms limit
(279 agent tests passed). It therefore did not finish the remaining unit
packages. The focused engine run above covers this change separately.

Lint initially passed, then one restart failed because Knip produced no
report; a focused `bun run lint` retry passed without code changes. The affected
run is not fully green. Logs: `/tmp/juno-speed-affected-final-3.log`,
`/tmp/juno-speed-focused-final.log`, and `/tmp/juno-speed-lint-final.log`.
After queueing at the 24-vCPU cap, final remote checks used the supported
`JUNO_REMOTE_MACHINE=linux/amd64:2x4` override. No pool limit was raised.

The sidebar holds its first list on an empty cache until the cold boot's quick start (membership, DM names, the first page of followed threads) is stored, then shows rows as the sync stores them. Clear bot channels are sorted into Automated as each one's history lands. Cached rows still paint immediately. Topic-row timestamps and status tags reserve their widths; the participant stack, the @ and the unread count keep no slot and take only their own width at the preview line's end, so one arriving cuts the preview shorter and moves nothing else (updated 10-16); New view stays beside Unread only while view pills fill.

All topics holds its first cold rows until the quick start is stored, and reserves the status-count and place-select widths and its scrollbar gutter. Cold-sync checks for Home and All topics hold thread subscriptions while the page paints, then release them under the same zero-shift probe.

### History order for unread counts (2026-10-18)

Until a conversation's history page lands, its unread count is a dot (`client.counts` says only that it is unread). The owner's order of 10-16 reads every DM and group DM first, then channels with an unread mention, then channels with unread followed threads, then the user's own channels, then the rest; an unread channel with no mention sat among the channels by recency. The 10-18 order keeps it and puts unread before read inside it: the unread DMs and group DMs before the read ones, and a new tier for the other unread channels, after the unread followed threads and before the user's own channels. Pacing and calls are unchanged.

A first version read every unread conversation before the read DMs. It was measured once, but the owner's order keeps all DMs first, so it was not kept.

`JUNO_LIVE=1 bun run sync:timeline` on the same workspace (147 active conversations), 1.51 s apart. The final order read 3 unread DMs, 51 read DMs, 1 channel with a mention, 18 other unread channels, then 74 others.

| Seconds from start | 10-17 (10-16 order) | Unread first (not kept) | 10-18 (final) |
| --- | --- | --- | --- |
| Unread DMs and mentions exact | about 83, estimated | 7.8 | 84.8 |
| No unread count left as a dot | 170.7 | 35.6 | 111.7 |
| Last history page | 221.8 | 222.2 | 222.8 |
| First sync ended | 242.9 | 235.1 | 235.9 |
| Calls | 366 | 367 | 368 |

The unread DMs were exact at 6.4 s. The mention waits behind the read DMs, as the owner's order says, so it lands where the 10-16 order put it; the 10-17 figure was not a milestone of those runs but that place (position 53 of 146) times the measured spacing. The other unread channels now come before the user's own channels and the rest, which takes the last dot from 171 s to 112 s. No 429 in either run. The tests that check these orders and the paced first sync run at a tenth of the app's spacing (`fakeSlackPaceScale`, `scaledPacing` in `@juno/slack`): every method's spacing, the total ceiling and the interactive refill divided alike, so the ratios hold and the two paced tests take 9 s instead of 174 s.

### Home ready before the first sync ends (2026-10-18)

Home used to wait for the whole first sync. With the history order of 10-18, the conversations Home is made of are read first: DMs and group DMs, conversations with an unread mention, then those with unread followed threads. Home is ready once they have history, the `getView` pages are stored and the preview search is done (`sync_state.homeReady`). The syncing line goes, Home's checks and AI titles start, and the rest of history fills in behind it. Until the first sync ends, an item a later conversation brings fills a free reserved slot below the rows shown, so nothing painted moves; a caught-up Home stays so for the visit. Recent, Automated's job and its record still wait for the boot.

`JUNO_LIVE=1 bun run sync:timeline`, the same workspace (147 active conversations), one run on each side:

| Seconds from start | Before (first-sync-order) | After |
| --- | --- | --- |
| Home ready | 235.9 | 86.1 |
| Unread DMs and mentions exact | 84.8 | 86.1 |
| Last history page | 222.8 | 224.0 |
| First sync ended | 235.9 | 236.9 |
| Calls | 368 | 368 |

Home was ready right after the last of the 54 DMs and the one channel with a mention; no channel had only unread followed threads. No 429. Unread counts settled at 268.8 s in the second run, after the sync had ended, which looks like a message arriving in the live workspace, not a sync change.

### First sync timeline (2026-10-17)

`JUNO_LIVE=1 bun run sync:timeline` on the owner's workspace: the whole engine signed in from an empty data folder, read-only, no AI key. 147 conversations active in the 7-day window, 146 with history, 842 thread rows, 33 `getView` pages. One run before the fixes and one with the final code, the same evening; single runs, not a distribution. (A run between them, with previews starting before the `getView` pages were stored, ended at 237 s.)

| Seconds from start | Before | After |
| --- | --- | --- |
| First sidebar rows (quick start) | 2.4 | 2.8 |
| Every active conversation listed | 23.4 | 23.4 |
| No unread count left as a dot | 170.7 | 170.7 |
| Last history page | 221.7 | 221.8 |
| Boot recorded: Home ready, AI jobs may start | 305.1 | 242.7 |
| Sync cycle ended: the sidebar not busy, the Syncing card gone | 395.7 | 242.9 |
| Last Slack call | 395.5 | 247.6 |

Calls before (367) and after (366), by method, with the time each was busy:

| Method | Calls | Before | After |
| --- | --- | --- | --- |
| `conversations.history` | 146 | 3 to 222 s | 3 to 222 s |
| `conversations.replies` (65 root lookups, 50 thread previews) | 115 | 7 to 305 s; previews 222 to 305 s | 24 to 248 s, beside history |
| edge `emojis/list` | 31 | 305 to 396 s | 3 to 93 s, beside history |
| `subscriptions.thread.getView` | 33 | 3 to 27 s | 3 to 27 s |
| edge `users/info` | 30, 29 | 3 to 208 s | 3 to 208 s |
| `search.modules.messages` (2 previews, 3 discovery) | 5 | discovery 222 to 235 s | discovery 222 to 242 s |
| everything else | 7 | before 3 s | before 3 s |

No call was rate limited in either run (0 HTTP 429, no `ratelimited` answer, no retry), so no `Retry-After` was seen. Local work is small: 18.6 s of CPU before and 13.1 s after over the whole run, the event loop 4 to 6 % busy, and SQLite statements 4.7 s and 6.7 s in total (3.0 and 4.4 s of it the `SELECT`s of merges and re-indexing, under 0.9 s inserts).

Where the 398 s went, largest first:

1. **History pacing, 219 s.** 146 pages, started 1.50 s apart (median and p90): the 40-a-minute background spacing of research section 6, not latency (66 s of the calls' own time) and not 429s. It is the critical path before and after.
2. **Emoji after the boot, 91 s.** 31 edge pages at 20 a minute ran after the boot was recorded and held the sync cycle, so the sidebar stayed busy. Fixed: they load beside the boot.
3. **Thread previews after history, 83 s.** 50 latest-reply fetches waited for history to end, although `replies` has its own clock. The boot, and so Home and AI titles, waited for them. Fixed: they run beside history once the `getView` pages are stored, woken by each history page.
4. **Discovery search after history, 13 to 21 s.** Three pages at 10 a minute; they need history's roots, so they stay after it. This is most of what remains between the last history page and the end.
5. **Not causes.** Rate limits (none hit), AI jobs (the sync does not wait for them; titles, Home's checks and the Automated check wait for the boot record, now 62 s sooner), repeated re-indexing and database writes (5 s of SQLite over the run), and `getView` (beside history, done by 28 s).

What is left is history at 40 a minute. Three ways to shorten it, each a product or policy choice rather than a safe fix: read history at the published Tier 3 rate of 50 a minute (about 44 s less here, less room for the official client on the same token; research section 6); record the boot, so Home is ready, once DMs, mentions and unread followed threads have their history rather than every conversation (SPEC 1 says Home comes after the first sync); or read history for quiet channels with nothing unread only when they are opened, which changes what the sidebar's previews and Automated's sorting have at first.

### First sync quick start and per-method pacing (2026-10-16)

`bun run bench:sync --latency 300 --until-quiet` on the Mac: the large seed, 300 ms per Slack call, production pacing, the same 471 Web API calls before and after, no rate-limit hits.

| | Before | After |
| --- | --- | --- |
| Sign-in to sidebar rows shown | 855 s (held until the whole boot ended) | 2.6 s |
| First channel or DM row in the index | 5.1 s | 1.0 s (from `client.counts`) |
| Boot to `live`, last call | 855 s | 545 s |
| `getView` call time | 147 s | 74 s (one `users/info` per page, not per thread) |
| Edge `users/info` calls | 471 | 153 |
| Unread threads shown as a dot | 33 | 0 |

The 33 dots before were threads whose reply coverage was recorded after their last re-index. Single runs, not a distribution. Full sync is now set by history alone: 300 calls at 40 a minute.

### Two-line topic titles (2026-10-18)

Measured on this Mac through the exclusive heavy lock, against `0579089f` with the same sidebar-reveal scenario added. Both production builds use the 1,200-topic seed and its 300-row sidebar window. The changed build selects Two lines through Appearance before measuring. Command: `bun run perf -g 'launch warm start|scroll frame times'`, with `JUNO_PERF_TOPIC_TITLES=two` for the changed build.

| Measurement | One-line baseline | Two-line build |
| --- | --- | --- |
| Continuous scroll frame work, p95 | 3.8 ms | 6.0 ms |
| Stepped scroll frame work, p95 | 3.8 ms | 8.9 ms |
| Held-clock stepped frame work, p95 | 4.3 ms | 3.9 ms |
| Dropped frames, continuous / stepped | 0.0% / 0.0% | 0.5% / 0.5% |
| Long animation frames, continuous / stepped | 0 / 0 | 0 / 2 |
| Show sidebar, p95 of eight opens | 22.7 ms | 22.6 ms |
| Warm start to rows, median of five launches | 802.7 ms | 538.7 ms |
| Snapshot to rows, median | 39.3 ms | 31.2 ms |
| Renderer private memory after scrolling | 207 MB | 186 MB |

The changed build meets the 8.3 ms continuous-scroll work budget and the 7 ms held-clock budget, but this run fails the zero-long-frame gate. Its two stepped-scroll frames were 58.6 and 50.8 ms, with no recorded script or blocking time; 38.1 and 43.1 ms elapsed before rendering began. An earlier two-line run passed scrolling at 4.8 ms continuous p95 with no long frames. These are separate runs, not pooled samples. The final run measured 761 continuous, 837 stepped and 844 held-clock frames; the baseline measured 764, 842 and 840.

Both builds fail the existing 500 ms median warm-start gate. Sidebar opening shows no observed regression; startup varies enough across these runs that the lower median is not evidence of a speedup. The completed combined commands both exited 1. The original logs are `/Volumes/AgentWork/two-line-titles-before.log` and `/Volumes/AgentWork/two-line-titles-after-final.log`.

A subsequent diagnostic pair ran only `scroll frame times`, with `JUNO_PERF_TRACE` enabled on both sides. Both exited 0 with no long frames. Baseline → two lines: continuous p95 5.2 → 5.0 ms, stepped 5.3 → 5.1 ms, held-clock 4.9 → 4.7 ms, dropped frames 0.3%/0.0% → 0.3%/0.0%. Loads were 3.2 and 3.4; frame counts were 763/835/839 and 760/838/841. The long-frame failure did not reproduce. These traced runs add CPU profiling and are kept separate from the first pair; the small difference is not evidence of a speedup. Logs and traces are under `/Volumes/AgentWork/two-line-titles-{before,after}-scroll-repeat.log` and `/Volumes/AgentWork/two-line-titles-trace-{before,after}`.

### 8.13 Dock badge and scoped counts (10-20)

A one-off benchmark (`packages/engine/test/bench/badge-query.test.ts`, removed on 10-24 once the plan was settled) built 5,000 topics across 300 conversations and 100,000 messages on a real migrated store. On the SSH runner with four CPUs available to the process (load 6.2), five alternating rounds of 100 scoped `topics.counts` queries per side returned identical results. The forced unread index took a median 0.244 ms per query, range 0.223–0.266 ms across the rounds. Letting SQLite choose took 0.037 ms, range 0.029–0.047 ms. The forced plan searched unread topics across the workspace; the chosen plan searched `topic_index_channel_activity` for the one conversation. The shared counts query no longer forces an index. An earlier two-CPU run gave 0.385 ms forced versus 0.053 ms chosen, with the same plans. These are warm query timings through the Effect adapter, not an app interaction speedup.

The same fixture's badge existence probe took 0.147 ms median and 0.205 ms p95 over 100 runs, range 0.123–1.567 ms. Its plan searched `topic_index_unread`, the messages primary key, read pointers and view membership indexes; it scanned none of the guarded tables. `plan.test.ts` checks the badge plan too. Settings and the finite domain decision table are cached between preference changes and minute boundaries. Unread rich-text attention is cached with its mention context and invalidated on content edits, so the query retains the actual sender without parsing every unread body on every run.

`plan.test.ts` keeps checking the badge's plan, and `badge-query.test.ts` its results.

`badge-query.test.ts` also stores a DM before its read pointer. The domain reports it unread, but the badge stays empty until read state is known; a late pointer marking it read never produces a dot. Normal cold boot loads counts before history. The guard also covers an early message from another path rather than relying on that ordering.

### 8.14 Search session first window (10-24)

The large-store Search benchmark now measures the actual session stream's first publication: resolving the query, loading 200 messages and 200 titles with one-row lookahead, shaping the results and producing its 100-row window. It also encodes and decodes the route's `SearchUpdate` schema. The fixture has 100,000 messages and 5,000 topics, with 10,000 longer messages arriving in 200-row transactions during 50 measured queries.

On the SSH runner with two allocated cores, the final session query p95 was 18.19 ms, the full window was 99,151 bytes, and encode/decode p95 was 2.22/2.05 ms. Palette query p95 was 8.77 ms. The earlier session run exceeded 40 ms: broad FTS queries looked up and sorted every match. A bounded FTS probe now chooses the existing date index when the candidate set exceeds the requested window; smaller sets retain FTS row lookups. Query-plan checks cover both paths. The Unicode mapper only builds offset maps when normalization changes boundaries.

These measurements cover the engine and codec on the runner. Search's Mac-only interaction spec requires samples for the expected keystrokes and arrows, and waits for the selected message to appear before each next arrow. It was not run for this change; no UI timing claim follows from the functional browser flows.

### 8.15 Re-indexing at start (10-27)

A warm start re-indexed every topic a page or the end of event coverage touched, and nearly all came out unchanged: 42 on the synced default workspace, 1,086 on a 300-conversation workspace. `reindexTopics` now stops at a topic whose inputs have not changed since its row was computed (section 6, "Re-index only what changed").

Measured on the SSH laptop on one physical core with an in-process probe (not committed; `/Volumes/AgentWork/scratch/reindex-start/zz-startcost.test.ts`): 40 warm starts of the synced default workspace, 15 first syncs of the default seed, and 6 warm restarts of a large seed (300 conversations, 400 threads, 6,000 messages over five days), each to rest. CPU is the test process's, engine and fake Slack together, per start. "Computed" counts the re-indexes that read the topic's messages and stored a mark.

| Per start | Before (`b377acc27`) | After |
| --- | --- | --- |
| Warm start, default: CPU | 0.123 s, 0.123 s (two runs) | 0.113 s |
| statements / rows | 873 / 1,135 | 738 / 866 |
| re-indexes computed / asked | 42 / 42 | 11 / 42 |
| First sync, default: CPU | 0.188 s, 0.175 s | 0.188 s |
| statements | 2,200 | 2,144 |
| Warm start, large: CPU | 0.648 s | 0.495 s |
| statements / rows | 18,955 / 28,776 | 13,948 / 18,749 |
| re-indexes computed / asked | 1,086 / 1,086 | 8 / 1,086 |

The default warm start's remaining computes are real input changes in the test template: messages a recheck page completes, page ranges it adds, live tails that end. SQL was about 19 ms of a 64 ms default warm start on this Mac (8 ms of it statements, the rest prepares, commits and closing), so the statements fell faster than the CPU; Effect's runtime and the fake are most of the rest. A first sync gains little: most of its re-indexes follow real changes, and each computed one now also writes its mark. The unit and DOM lanes, one run each on two cores with seed 4242: `test` 62 s and about 211 CPU-s before, 40 s and about 122 CPU-s after; `test:dom` 48 s and about 155 CPU-s before, 56 s and about 160 CPU-s after. Single runs on the shared laptop move more than the change.

Output: a probe compared the index, the attention cache, the sidebar, its unread filter and Home after a first sync, two warm restarts, a live message and reply, and a catch-up over messages sent while stopped, on four seeds (default, the 300-conversation mutation seed, topic300 and the large seed), with engine time pinned to the seed time. Every row and value matched main except `rev`, a per-row write counter: 2 rows of the default seed and 8 of the large one end on a different count. That comes from how concurrent first-sync pages and re-indexes interleave, which moves with the number of statements a re-index runs: two `SELECT 1` added to main's `reindexTopics` give the same `rev` values. `attention_context`, the attention cache's key, now holds the full user from the start of a run, where before it alternated with the user id alone until `client.userBoot` answered.

Seen and not changed: Automated's pass samples every unsettled conversation on every start (34 samples on the default workspace, 518 on the large one, 1.7 ms of SQL a default start), and a warm start opens 44 write transactions on the default workspace and 593 on the large one.
