---
name: performance
description: Performance rules for Juno. Use when building or reviewing any UI, list, tab, IPC or live-query payload, SQL query, engine job, or startup path. Covers the budgets, the non-negotiable rules for lists, interaction, React state, the engine and Electron, and how to measure. Detail and sources are in docs/performance.md.
---

# Performance in Juno

The bar: the app must feel native and insanely fast. Input paints on the next frame, nothing the user sees waits for Slack, scrolling never drops a frame, and a change that slows the app fails the build. `docs/performance.md` has the numbers, the reasons and the sources; this file is the short form.

## Budgets to keep in mind (p95, reference M1 Air, 120 Hz)

- Direct feedback (tab switch, press state): one frame, 16 ms. A keystroke's character: within one refresh interval of a bare `<input>` in the same run (`docs/performance.md` 7.1).
- Topic open (cached), filter change, ⌘K open, send → pending row: 50 ms.
- Write → pixels for a live query update: 50 ms. ⌘K keystroke → results: 100 ms.
- Cold start → sidebar rows from the local cache: 800 ms p50. Shell visible: 400 ms p50.
- Scroll: no frame over 8.3 ms of main-thread work, zero long animation frames (> 50 ms).
- Engine: one query run 5 ms, one event transaction 5 ms, no sync block over 50 ms after boot.
- Memory, large workspace: renderer 250 MB private, engine 300 MB. Renderer JS 1.1 MB, CSS 200 KB (minified).
- Live query messages: snapshot ≤ 200 KB, delta ≤ 32 KB, encode and decode ≤ 5 ms each.

## Non-negotiable rules

**Lists**

1. The sidebar list and the message list are in-flow rows with `content-visibility: auto` and `contain-intrinsic-size: auto <estimate>`; the live query window is the virtualizer (300 topic rows, 100 to 500 message rows). No scroll handlers, no absolute positioning, no `overflow-anchor: none`. Prepends rely on Chromium scroll anchoring, so nothing in that frame may change `position`, `transform`, `overflow` or `display` on the scroller or the anchor's ancestors.
2. `@tanstack/react-virtual` is the only virtualization library, used for unbounded flat lists (All topics, Browse) and as the measured escalation for the message list (`docs/performance.md` 3.4). Do not add another.
3. Every image box has `aspect-ratio` from file metadata before the bytes arrive. Late content never moves what the user is reading.
4. Rows set `contain: content`. Section headers are `position: sticky`. A message row's height depends only on its message, never on its place in the window, and is a whole number of pixels (the content box rounds up with `calc-size`), so scroll anchoring moves the list by exact amounts. Only real upward input lets go of a held bottom: the wheel or trackpad moving up, an up key, or a press held on the list. A change in scroll position alone never does, because a full window drops rows from the top and the scroll position falls with no input (`docs/performance.md` 3.3).

**Interaction**

5. Navigation (rows, tabs, nav items, filter chips, palette and Browse rows, thread links) activates on `pointerdown`: primary button only, not with `ctrlKey`, not inside a nested control; `metaKey` opens a new tab. Menu and popover triggers open on primary mouse `pointerdown` through `menuTriggerHandlers` in `@juno/ui`; their following click is ignored. Mutating buttons (Resolve, Send, Pin, close) activate on `click`. Keep `onClick` for assistive tech with a flag against double activation.
6. Prefetch on hover, focus or keyboard selection: mount the topic's `messagesAtom` (idle TTL 30 s, at most 3 warm). Local query only; the Slack fetch starts on the real open.
7. The active tab and the 4 most recent topic tabs stay mounted in `<Activity mode="hidden">`. Older tabs keep a scroll snapshot and restore it in `useLayoutEffect` before paint. Every effect must clean up; hidden means unmounted.
8. No spinner under 300 ms, never a global one. Skeletons only with the final geometry. Filter, tab and theme changes show the finished state in one frame, never an empty intermediate. `startTransition` does not hold atom state (`useAtomValue` commits synchronously): a list that switches its source atom holds the previous window in the atom, as `sidebarListAtom` does (`docs/performance.md` 5.3).
9. Hover, press, focus and selection are CSS pseudo-classes, never React state. Only `transform` and `opacity` animate. `will-change` only while an element animates, never on rows or the shell; the one exception is a text field inside a large layer with blurred shadows (the ⌘K field, `docs/performance.md` 2.3).

**React and state**

10. The list container subscribes to `order` only; each row subscribes to its own `Atom.family` member. Rows and messages are `React.memo` with primitive or `rev`-stable props and id-taking callbacks created once. Time is a leaf component reading `nowAtom`; rows pass `ts`.
11. Deltas are applied into a `Map` by id; unchanged `rev` keeps object identity; decode only the `upsert` rows. Derived object atoms use `Atom.withEquality`.
12. ⌘K uses `useDeferredValue` on the query with no debounce for local search; only the AI parse is debounced.
13. No layout reads (`getBoundingClientRect`, `offsetHeight`, `scrollTop`) in render or next to writes; batch reads in one `requestAnimationFrame` before writes. ResizeObserver callbacks record, never write; the one exception is a message list's observer on its scroller and inner column, which puts the held bottom back after layout and before paint when either changes size. When the bottom is not held, that callback checks only the pin and returns without reading layout or writing. Changing Topic titles is also a one-time exception: capture the first visible sidebar row, change the line-limit variable, and restore that row’s top in the layout effect before paint. No observer or scroll handler is added. A `selectionchange` listener asks for one read in the next frame and builds the range from the selection's anchor and focus: `getRangeAt` and `Selection.toString()` lay out the page (`docs/performance.md` 8.10).

**Engine and IPC**

14. Every live query has an anchor and a count, specific invalidation keys, and an `EXPLAIN QUERY PLAN` test that fails on a `SCAN` of `messages`, `topic_index`, `reactions` or `topic_overlay`. Emit deltas by `rev` only.
15. One writer transaction per event or command in `Reactivity.withBatch`; backfill in ≤ 200-row transactions with `Effect.yieldNow` between. A user command's invalidation is never debounced; background re-runs debounce 30 ms trailing.
16. Port payloads are flat, JSON-shaped view models; no `Date`, `Map`, class instances, no histories. Every message carries `meta: { queryMs, encodeMs, seq }`. File bytes in ≤ 1 MB chunks.
17. No `ipcRenderer.sendSync`, no sync work in main after `ready`, no new process, window, `webview` or `BrowserView`.

**Startup**

18. The shell paints with no data; `show` on `ready-to-show` with `backgroundColor` from the saved theme. The engine answers the first `topics.list` from `cache.db` before any Slack call. AI, notifications, emoji, lazy pages and prefetch run after the first sidebar paint. `juno://` has `codeCache: true`; `v8CacheOptions: 'bypassHeatCheck'`. Latin fonts are preloaded; fallback faces are size-adjusted. Background throttling stays on. A prefetched chunk's components come from `chunk()` (`containers/chunks.ts`); a bare `lazy` waits 300 ms on its first open even when loaded (`docs/performance.md` 8.5).
19. Adding a dependency or a page to the initial bundle needs a before/after size from the bundle check. Never change a budget in `scripts/check-bundle-size.mjs` or `docs/performance.md`, up or down, without Tushar; make room by moving code behind `chunk()`. Moving code out of the initial bundle to fit needs a before/after first-screen run (`bun run perf -g "launch"`), and launch time decides, not the size number.

**Electron chrome**

20. `-webkit-app-region` goes on title bar strips (`drag`) and on the container of each control group inside them (`no-drag`), never on a primitive or a row. Every surface that can open over a title bar (popover, list, overlay, floating picker, sheet) sets `no-drag` once on its root. It is inherited, and with a region on every control Chromium took about twice as long to apply each scroll offset and to finish each layout: 6 to 18 % of a scroll's frame work (`docs/performance.md` 8.5). The `app.spec.ts` title bar test fails above 20 region roots.

## Measure changes to a measured path

- Instrument with `@juno/state/perf.ts` marks (`juno.topic-open`, `juno.tab-switch`, ...) so the DevTools "Juno" track and the harness see the change.
- Bundle: `bun run build` runs `scripts/check-bundle-size.mjs` (initial JS 1.1 MB, CSS 200 KB minified). Phosphor icons ship every weight in one module; `phosphorWeights` in `apps/desktop/renderer.vite.ts` drops thin and light at build time (about 66 KB, measured 10-15), and duotone from every icon `packages/ui/src/duotone.ts` does not import (about 37 KB, 10-17), so a new `IconWeight` must be added to its list too, and a new duotone icon goes in `duotone.ts`.
- New per-row, per-frame or startup work, or any change to an area's hot path (startup, sidebar, topic open and the message list, scroll, composer and send, search and the palette, the Juno chat and panel, Home, emoji): run that area's perf scenarios on the laptop before you report, `bun run remote --cores 2 perf --area <area>` (`AREAS` in `scripts/perf.mjs`), or the finer `-g "<pattern>"` that `bun run affected --plan` names from `PERF_INTERACTIONS` in `scripts/test-areas.mjs`. The small set's metrics (`@proxy`, `docs/performance.md` 7.3) fail on a regression against the laptop's baseline (`perf-baseline.json`); the others print their numbers and pass, so compare them with the same run on `origin/main` when one looks off. Timed perf runs only on demand: the plain `bun run perf` runs the small set, `bun run perf --full` everything. The absolute budgets above are checked on the Mac by hand (`bun run perf --area <area>` or `--full`, queued on the heavy-job lock), when Tushar asks or before a release. A change that moves a small-set number on purpose refreshes the baseline with `bun scripts/perf-baseline.mjs update` over a quiet and a loaded laptop run, with the reason in the commit. A real slowdown that the small set missed adds a scenario to it. To find the cost, add `JUNO_PERF_TRACE=<dir> JUNO_UNMINIFIED=1` and read the result with `bun scripts/perf-trace.mjs` (`docs/performance.md` 7.3). Drive clicks with the driver's `press`: a pointerup in the next frame defers the measure's end by a frame.
- A list or scroll change is tested in a topic past the window cap (more messages than the loaded window), with real gestures: trackpad momentum, fingers resting on the trackpad, a held scrollbar thumb. Reaching the bottom with a programmatic jump, or a fake topic that never fills the window, misses whole classes of bugs.
- For a change to a measured interaction, `bun run affected` runs its feel scenario on the laptop (`test:desktop --project=feel`); a failed scenario's filmstrip is in `apps/desktop/test-results/feel-report/` of the run's results. `bun run test:feel -g "<name>"` records it in Electron on the Mac with full videos, when Tushar asks.
- Query change: run the plan test and the engine benchmark.
- Every test run checks counted budgets in the fast tests (renders, queries, IPC bytes, layout work); timed perf is on demand only and no full run or nightly includes it. Other UI changes are covered by the counted budgets and the feel scenarios, and by `test:feel` in `bun run verify:main --with-mac` when Tushar asks. If unsure, say so in your report.
- By hand: `bun run dev`, DevTools Performance panel, repeat the interaction 5 times, read the Juno and React tracks and the long-animation-frame entries (`window.__juno.perf`).

## Delayed data

Run `bun run remote test:desktop layout-shift.spec.ts` for renderer changes that affect opening or loading. Full runs (`bun run verify:main`) include it. Its frame-by-frame screen anchor check requires exactly 0 px movement, alongside Layout Shift entries excluding recent input. Hold fake Slack methods and release them in the measured action; assert both the held request and the final UI so a no-op cannot pass. Prove additions with `bun run flake apps/desktop/e2e/layout-shift.spec.ts --repeat 20 --machines 1`. See docs/development.md, "Delayed-load layout checks".

Partial message windows do not establish the open position. The header and composer paint within the existing uncached-open budget while the body waits for history coverage. Keep eager rows around the divider after the first paint. Message reaction and Main thread-link slots reserve their height before metadata arrives; sender and Threads counter widths are fixed. Sidebar rows keep no slot for the participant stack, the @ or the unread count: they take their own width at the preview line's end and cut the preview shorter, never moving anything else (owner rule: no blank space for content that might arrive); on an empty cache, its first list waits for cold sync membership, and a channel the Automated rules have not decided waits out of All until its history is sorted, 5 s at most (`automated_holds`), while people channels and DMs show at once. Cached sidebar rows paint immediately. All topics holds its first cold rows until sync completes and reserves count and place-select widths and a scrollbar gutter before data arrives.

## Review questions

1. Does it paint on the next frame?
2. Does it add work per row, per tick, or per scroll frame?
3. Does it run before the first sidebar paint?
4. Is the query windowed and indexed? Does the payload grow?
5. Did memory or bundle size move?
