---
name: performance
description: Performance rules for Juno. Use when building or reviewing any UI, list, tab, IPC or live-query payload, SQL query, engine job, or startup path. Covers the budgets, the non-negotiable rules for lists, interaction, React state, the engine and Electron, and how to measure. Detail and sources are in docs/performance.md.
---

# Performance in Juno

The bar: the app must feel native and insanely fast. Input paints on the next frame, nothing the user sees waits for Slack, scrolling never drops a frame, and a change that slows the app fails the build. `docs/performance.md` has the numbers, the reasons and the sources; this file is the short form.

## Budgets to keep in mind (p95, reference M1 Air, 120 Hz)

- Direct feedback (tab switch, composer keystroke, press state): one frame, 16 ms.
- Topic open (cached), filter change, ⌘K open, send → pending row: 50 ms.
- Write → pixels for a live query update: 50 ms. ⌘K keystroke → results: 100 ms.
- Cold start → sidebar rows from the local cache: 800 ms p50. Shell visible: 400 ms p50.
- Scroll: no frame over 8.3 ms of main-thread work, zero long animation frames (> 50 ms).
- Engine: one query run 5 ms, one event transaction 5 ms, no sync block over 50 ms after boot.
- Memory, large workspace: renderer 250 MB private, engine 300 MB. Renderer JS 1.0 MB, CSS 150 KB.
- Live query messages: snapshot ≤ 200 KB, delta ≤ 32 KB, encode and decode ≤ 5 ms each.

## Non-negotiable rules

**Lists**

1. The sidebar list and the message list are in-flow rows with `content-visibility: auto` and `contain-intrinsic-size: auto <estimate>`; the live query window is the virtualizer (300 topic rows, 100 to 500 message rows). No scroll handlers, no absolute positioning, no `overflow-anchor: none`. Prepends rely on Chromium scroll anchoring, so nothing in that frame may change `position`, `transform`, `overflow` or `display` on the scroller or the anchor's ancestors.
2. `@tanstack/react-virtual` is the only virtualization library, used for unbounded flat lists (All topics, Browse) and as the measured escalation for the message list (`docs/performance.md` 3.4). Do not add another.
3. Every image box has `aspect-ratio` from file metadata before the bytes arrive. Late content never moves what the user is reading.
4. Rows set `contain: content`. Section headers are `position: sticky`.

**Interaction**

5. Navigation (rows, tabs, nav items, filter chips, palette and Browse rows, thread links) activates on `pointerdown`: primary button only, not with `ctrlKey`, not inside a nested control; `metaKey` opens a new tab. Mutating buttons (Resolve, Send, Pin, close) activate on `click`. Keep `onClick` for assistive tech with a flag against double activation.
6. Prefetch on hover, focus or keyboard selection: mount the topic's `messagesAtom` (idle TTL 30 s, at most 3 warm). Local query only; the Slack fetch starts on the real open.
7. The active tab and the 4 most recent topic tabs stay mounted in `<Activity mode="hidden">`. Older tabs keep a scroll snapshot and restore it in `useLayoutEffect` before paint. Every effect must clean up; hidden means unmounted.
8. No spinner under 300 ms, never a global one. Skeletons only with the final geometry. Filter, tab and theme changes show the finished state in one frame (`startTransition`), never an empty intermediate.
9. Hover, press, focus and selection are CSS pseudo-classes, never React state. Only `transform` and `opacity` animate. `will-change` only while an element animates, never on rows or the shell.

**React and state**

10. The list container subscribes to `order` only; each row subscribes to its own `Atom.family` member. Rows and messages are `React.memo` with primitive or `rev`-stable props and id-taking callbacks created once. Time is a leaf component reading `nowAtom`; rows pass `ts`.
11. Deltas are applied into a `Map` by id; unchanged `rev` keeps object identity; decode only the `upsert` rows. Derived object atoms use `Atom.withEquality`.
12. ⌘K uses `useDeferredValue` on the query with no debounce for local search; only the AI parse is debounced.
13. No layout reads (`getBoundingClientRect`, `offsetHeight`, `scrollTop`) in render or next to writes; batch reads in one `requestAnimationFrame` before writes. ResizeObserver callbacks record, never write.

**Engine and IPC**

14. Every live query has an anchor and a count, specific invalidation keys, and an `EXPLAIN QUERY PLAN` test that fails on a `SCAN` of `messages`, `topic_index`, `reactions` or `topic_overlay`. Emit deltas by `rev` only.
15. One writer transaction per event or command in `Reactivity.withBatch`; backfill in ≤ 200-row transactions with `Effect.yieldNow` between. A user command's invalidation is never debounced; background re-runs debounce 30 ms trailing.
16. Port payloads are flat, JSON-shaped view models; no `Date`, `Map`, class instances, no histories. Every message carries `meta: { queryMs, encodeMs, seq }`. File bytes in ≤ 1 MB chunks.
17. No `ipcRenderer.sendSync`, no sync work in main after `ready`, no new process, window, `webview` or `BrowserView`.

**Startup**

18. The shell paints with no data; `show` on `ready-to-show` with `backgroundColor` from the saved theme. The engine answers the first `topics.list` from `cache.db` before any Slack call. AI, notifications, emoji, lazy pages and prefetch run after the first sidebar paint. `juno://` has `codeCache: true`; `v8CacheOptions: 'bypassHeatCheck'`. Latin fonts are preloaded; fallback faces are size-adjusted. Background throttling stays on.
19. Adding a dependency or a page to the initial bundle needs a before/after size from the bundle check.

## Measure before you call it done

- Instrument with `@juno/state/perf.ts` marks (`juno.topic-open`, `juno.tab-switch`, ...) so the DevTools "Juno" track and the harness see the change.
- Bundle: `pnpm build` runs `scripts/check-bundle-size.mjs` (initial JS 1.0 MB, CSS 150 KB; now 426 KB and 69 KB).
- Interaction or list change: once the harness exists (not built yet, `docs/performance.md` 7.3), run the matching scenario in `apps/desktop/perf/` (`pnpm perf`), compare to `baselines.json`. CI fails at p95 over budget or median 15 % over baseline. Changing a baseline needs a PR that says why.
- Query change: run the plan test and the engine benchmark.
- By hand: `pnpm dev`, DevTools Performance panel, repeat the interaction 5 times, read the Juno and React tracks and the long-animation-frame entries (`window.__juno.perf`).

## Review questions

1. Does it paint on the next frame?
2. Does it add work per row, per tick, or per scroll frame?
3. Does it run before the first sidebar paint?
4. Is the query windowed and indexed? Does the payload grow?
5. Did memory or bundle size move?
