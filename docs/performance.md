# Performance

Version 1, October 2026. This document sets the speed budgets for Juno, says how to hit them, and says how they are measured so a change that breaks them fails the build. `docs/architecture.md` decides structure; where this document asks for a structural change, the architecture is updated in the same milestone. Agents load `.claude/skills/performance/SKILL.md` for the short rules; this is the detail.

The goal in the owner's words: the app must feel native and insanely fast. In practice that means three things. Input shows a result on the next frame. Nothing the user sees waits for Slack. Scrolling never drops frames.

Reference hardware: a base M1 MacBook Air (8 GB) with a 120 Hz display assumed, so a frame is 8.3 ms. CI runs on GitHub's `macos-26` runner, which is slower; section 8 explains how the two are kept comparable.

## 1. Budgets

Every budget is a p95 over the runs of the scenario in section 8 unless marked p50. "Painted" means the frame that shows the result is presented, measured from the user input event (`pointerdown`, `keydown`) or from process launch.

| Metric | Budget | Notes |
| --- | --- | --- |
| Cold start → window visible with the shell (sidebar bar, tab strip, empty list) | 400 ms p50, 600 ms p95 | From `app` launch to the first presented frame. The shell is static chrome; it needs no data. |
| Cold start → first sidebar rows painted from the local cache | 800 ms p50, 1 200 ms p95 | Large workspace, OS file cache warm. Slack is not contacted before this point. |
| Warm start (second launch within a minute) → first sidebar rows | 500 ms p50 | V8 code cache and OS caches hot. |
| Topic open, cached (rows already in `cache.db`) | 50 ms | `pointerdown` on a row → messages painted at the right scroll position. 16 ms when the topic was prefetched (section 4.2). |
| Topic open, uncached (never synced) | 50 ms to header and empty body; no spinner before 300 ms | Messages arrive whenever Slack answers; the list must not shift when they do. |
| Tab switch | 16 ms | One frame. Recently used tabs stay mounted (section 4.3). Unmounted tabs: 50 ms including scroll restore. |
| Sidebar filter or scope change | 50 ms | Query, delta, render. The old list stays on screen until the new one is ready. |
| ⌘K open | 50 ms | Input focused and recent rows painted. |
| ⌘K keystroke → results painted | 100 ms, typing never blocked | Local FTS only. The AI command parse arrives later and never delays results. |
| Composer keystroke → character painted | 16 ms; zero long animation frames while typing | Event Timing `duration` for `keydown` ≤ 32 ms. |
| Send (Enter) → pending message painted | 50 ms | Local transaction, delta, render. The Slack call is invisible. |
| Scroll, sidebar and message list | p95 frame ≤ 8.3 ms main-thread work; zero long animation frames (> 50 ms) in a 3 s scroll at 2 000 px/s; dropped frames < 1 % | Measured with a CDP trace and the LoAF observer. |
| Live query update, write → pixels | 50 ms | Engine commit → invalidation → query → encode → port → decode → render → paint. Background (socket) updates may add the 30 ms trailing debounce; user commands may not. |
| Engine: one live query run (sidebar window, messages window) | 5 ms; FTS query 20 ms | 5 k topics, 100 k messages. Asserted by the engine benchmark with `EXPLAIN QUERY PLAN`. |
| Engine: one socket event transaction, including `reindexTopics` | 5 ms | Backfill transactions ≤ 200 rows and ≤ 20 ms. |
| Engine: longest synchronous block of the event loop after boot | 50 ms | Boot may parse `userBoot` in one block; nothing after it may. |
| Memory after the large-workspace scenario (boot, 20 topics opened, 50 tab switches, 2 minutes of scrolling) | Renderer private 250 MB, JS heap 120 MB; engine private 300 MB; main 80 MB | `app.getAppMetrics()` and `process.getProcessMemoryInfo().private`. Three repetitions of the scenario must not grow the renderer heap by more than 5 %. |
| Renderer bundle | Initial JS ≤ 1.0 MB uncompressed, CSS ≤ 150 KB; pages other than the sidebar and topic view are lazy chunks | The built shell ships 426 KB of JS (139 KB gzip) and 69 KB of CSS, minified. `scripts/check-bundle-size.mjs` runs at the end of `pnpm build` and fails over budget. Measure before adding a dependency. |
| Live query message size | Snapshot ≤ 200 KB; any delta ≤ 32 KB; encode and decode ≤ 5 ms each side | From architecture 2.6, criterion 5. Larger means the window or the view model is wrong. |

Where these numbers come from: 100 ms is the limit under which a response feels immediate and 10 ms per frame is the animation target in Google's RAIL model ([web.dev/rail](https://web.dev/articles/rail)); Juno targets a frame (16 ms, or 8.3 ms at 120 Hz) for direct feedback because native macOS apps do. 50 ms is the long-animation-frame threshold ([Chrome LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames)) and 200 ms is the "good" Interaction to Next Paint limit ([web.dev/inp](https://web.dev/articles/inp)); Juno's interaction budgets sit well under it. Apple's 120 Hz guidance is in [WWDC21 session 10147](https://developer.apple.com/videos/play/wwdc2021/10147/).

## 2. Electron

### 2.1 Startup

Order of work at launch, in parallel where the arrows allow:

1. Main: `app.enableSandbox()`, set `userData`, read a tiny `launch.json` (theme, window bounds) synchronously. Build the application menu before `ready` ([Electron performance tutorial](https://www.electronjs.org/docs/latest/tutorial/performance)).
2. Main: fork the engine (`utilityProcess.fork` with `serviceName: 'juno-engine'` so it is named in metrics) and create the window in the same tick. Do not wait for one to start the other.
3. Window: `show: false`, `backgroundColor` set to the token background of the saved theme (dark users must never see a light flash), `show()` on `ready-to-show` ([BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)). `ready-to-show` fires after the first paint, so the shell must paint with no data: the `App` renders the sidebar bar, filters, tab strip and an empty list before any atom resolves.
4. Renderer: request the port, subscribe `topics.list` for the default filter. The engine opens the databases and answers from `cache.db` before it opens the socket or calls Slack. Boot network work starts after the first sidebar snapshot has been sent.
5. Everything else is deferred: AI jobs, notification pipeline, digest scheduler, emoji table, and in the renderer the lazy page chunks and icon sets. Renderer deferral uses `requestIdleCallback`; engine deferral waits for the first snapshot and then yields between steps.

Rules:

- **V8 code cache on `juno://`.** Register the scheme with `codeCache: true` as well as `standard` and `secure`; the code cache only covers `http(s)` otherwise and `codeCache` requires `standard` ([custom scheme privileges](https://www.electronjs.org/docs/latest/api/structures/custom-scheme)). Set `webPreferences.v8CacheOptions: 'bypassHeatCheck'` so the main bundle is cached on the first run ([web preferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)). Measure warm start before and after; keep it if it helps.
- **No synchronous IPC.** `ipcRenderer.sendSync` blocks the renderer until main answers ([ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer)); `pnpm lint` fails on it (`scripts/check-deps.mjs`). `@electron/remote` is not used. Main never does work that could block the UI thread: no sync file reads after `ready`, no JSON of any size, no `net` waits.
- **One bundle per process, workspace packages bundled.** No `require` at runtime in the renderer. Pages other than the sidebar and topic view (`Preferences`, `Notifications`, `For you`, `Juno`, `All topics`, `New message`) are `React.lazy` chunks, prefetched on idle after the sidebar paints.
- **Fonts.** Bundled, never from a URL. The two Latin files (Figtree variable, Instrument Serif) are `<link rel="preload" as="font">` in `index.html` so they are ready before the first content paint; other subsets load on demand. `@font-face` uses `font-display: swap` plus a `size-adjust`/`ascent-override` fallback face built from the system font so a swap never moves text ([font-display](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display), [size-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust)). The e2e asserts `document.fonts.check` for both faces before the first rows.
- **Background throttling stays on** (default `true`). Timers and `requestAnimationFrame` in a hidden window slow to 1 Hz, which is what we want: the engine owns the clock and the network, and port messages are still delivered. Nothing in the renderer may rely on a timer firing while hidden. Do not call `setBackgroundThrottling(false)`; it affects the whole window ([webContents](https://www.electronjs.org/docs/latest/api/web-contents)).
- **Process count is fixed**: main, one renderer, the engine, Chromium's GPU and network helpers. No second window, no `webview`, no `BrowserView` for a feature. Every process costs tens of MB and a startup.

### 2.2 IPC and the port

- A live query message is a plain JSON-shaped object: no `Date`, `Map`, class instances or `undefined` holes. Structured clone cost grows with object count, not bytes, so view models are flat: `TopicRow` is one object with primitive fields and one small `preview` object, not a tree.
- Snapshots cover a window (architecture 2.6), never a history. The sidebar window is 300 rows; the message window starts at 100 and grows to 500. A message that exceeds the size budget in section 1 is a bug in the query, not a reason to raise the budget.
- Deltas carry only rows whose `rev` changed. The engine diffs against the last snapshot it sent on that subscription.
- Pasted file bytes go over the port in chunks of at most 1 MB. `ArrayBuffer` transfer is not available on `MessagePortMain`; buffers are copied ([MessagePortMain](https://www.electronjs.org/docs/latest/api/message-port-main)).
- The preload stays a few hundred bytes. It forwards the port and exposes the small `window.juno` surface, nothing else.

### 2.3 Rendering and compositing

- Only `transform` and `opacity` are animated. They run on the compositor; everything else forces style, layout or paint on the main thread. Press scale and hover colour are CSS, never JavaScript state.
- `will-change` is set on an element only for the duration of its animation (menus, toasts, popovers while entering) and removed after. Never on rows, lists or the app shell: each promoted layer costs GPU memory and compositing time.
- No `backdrop-filter`, no large blurred `box-shadow` on anything that scrolls. Shadows live on floating surfaces (menus, popovers, toasts).
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

Why `content-visibility` first. Rows stay in the DOM and in flow, so Chromium's own scroll anchoring handles prepends and reorders, ⌘F finds text in every loaded row, text selection runs across rows, the accessibility tree is complete, keyboard focus moves with plain `tabindex`, and `position: sticky` gives the Pinned and Recent headers for free. Chromium skips style, layout and paint for rows outside the viewport and remembers their last size with `contain-intrinsic-size: auto <estimate>`, so the scrollbar stays stable; Google measured a 7× rendering win on long pages ([web.dev/content-visibility](https://web.dev/articles/content-visibility), [contain-intrinsic-size](https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size)). The cost is bounded by the window: 500 messages at about 40 nodes each is 20 k nodes, which Chromium handles without trouble as long as off-screen rows are not rendered.

Why TanStack Virtual over the others (versions as of 2026-10-12). `@tanstack/react-virtual` 3.14 is headless (we own the DOM, ARIA and StyleX), 8 kB, and has what a chat list needs: `anchorTo: 'end'` with `followOnAppend` for stick-to-bottom and prepend-stable content, `measureElement` with a ResizeObserver for dynamic heights, `getItemKey` for stable keys across prepends, and `rangeExtractor` for sticky headers ([Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)). `react-virtuoso` 4.18 ([virtuoso.dev](https://virtuoso.dev/)) has the nicest chat API (`followOutput`, `firstItemIndex`) and in-flow rows, but is 19 kB, measured slower on dynamic measurement in TanStack's benchmark, and documents that margins and late images break its measurement. `virtua` 0.53 ([github.com/inokawa/virtua](https://github.com/inokawa/virtua)) is small and has a `shift` prop for prepends but no stick-to-bottom and experimental sticky headers. `react-window` 2 has neither reverse lists nor prepends. None of them emit ARIA, so we would write it anyway. Every one of them loses unmounted rows for ⌘F and selection, which is the reason the message list does not start on a virtualizer.

### 3.2 Rules for the sidebar list

- Rows are keyed by topic id. React moves DOM nodes on reorder; the browser's scroll anchoring keeps the viewport stable when the user is scrolled down. At `scrollTop === 0` new activity pushes rows down, which is the WhatsApp behaviour the spec wants.
- Every row: `content-visibility: auto; contain-intrinsic-size: auto 92px` (chat style, balanced density; the number comes from the primitive's measured height per style and density and lives in tokens).
- Section headers are `position: sticky; top: 0` inside the scroll container. Sticky elements and the row that contains the keyboard focus are never skipped; Chromium renders focused content regardless.
- Keyboard: roving `tabindex` on rows (one row is `0`, the rest `-1`); ArrowUp/Down move focus; focus moves scroll the row into view with `block: 'nearest'` and `behavior: 'instant'`.
- The window is 300 rows. The list shows "Older topics are in All topics" after the last row rather than paging. Changing the filter re-anchors the window; the old rows stay until the new snapshot arrives (section 5.3).

### 3.3 Rules for the message list

- Bottom-anchored: the container is a normal `overflow-y: auto` column; "stick to bottom" is a boolean in the container (`isAtBottom`, true when within 32 px of the end at the last `scrollend`). On a delta that appends while `isAtBottom`, scroll to the end in the same `useLayoutEffect`, before paint. When not at the bottom, show the "N new messages" affordance and leave the viewport alone.
- Open position: if the topic has unread messages, the first paint already has the "N new" divider 80 px from the top (`useLayoutEffect` scrolls before the frame is presented); otherwise the first paint is at the bottom. There is no visible jump.
- Prepending older pages: rows are inserted at the top in flow; Chromium's scroll anchoring keeps the visible messages fixed ([overflow-anchor](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor), [CSS scroll anchoring spec](https://drafts.csswg.org/css-scroll-anchoring/)). Nothing may trigger anchoring suppression in that frame: no change to `position`, `transform`, `overflow` or `display` on the scroller or the anchor's ancestors, and no `overflow-anchor: none` anywhere in the list. Request the next page when the first row is within 1 000 px of the top, at most one request in flight.
- Window cap: 500 rows. Beyond it, the end furthest from the viewport is dropped from the subscription window. Dropping rows at the bottom clears `isAtBottom`; "Jump to bottom" re-anchors the window at the end and scrolls there.
- Late-loading images never change layout: every image box gets `aspect-ratio` and a max size from Slack's `thumb_w`/`thumb_h` (or `original_w`/`original_h`) before the bytes arrive. A file with no dimensions renders as a fixed-height card. The catch-up card and the grouping suggestion arrive after the first paint; they insert above the anchor and scroll anchoring absorbs them, but they must still have no entering animation that changes height.
- Messages set `content-visibility: auto; contain-intrinsic-size: auto 56px` and `contain: content`. Text is selectable (`user-select: text` on bodies, `none` on chrome). Because rows stay in flow, selection and ⌘F behave like a normal page for the whole window.
- Reactions, hover toolbars and the selection-quote button are positioned inside the message's containing block so they never force a layout of the list.
- Sticky date separators, if added, use `position: sticky` like the sidebar headers.

### 3.4 Measurement gate and the escalation

The M4 benchmark opens a cached topic with 300 messages (20 % with image attachments, 10 % with code blocks) and asserts: first paint in 50 ms, scroll scenario within the frame budget, and prepending a 100-row page with zero visible shift (the anchor message's `getBoundingClientRect().top` unchanged after the commit). If the open or the scroll budget fails on the reference Mac after per-row memoization is confirmed working, the message list moves to `@tanstack/react-virtual` with these rules: `anchorTo: 'end'`, `followOnAppend` tied to `isAtBottom`, `getItemKey` = message key, `measureElement` with `useAnimationFrameWithResizeObserver`, `scrollToIndex(dividerIndex, { align: 'start' })` with an 80 px scroll margin for the open position, rows rendered in DOM order with `aria-setsize` and `aria-posinset`, and an overscan of 8 rows so selection drags across a screen's worth of neighbours. ⌘F then covers only mounted rows; Juno's own search covers the rest.

### 3.5 Rules for TanStack lists (All topics, Browse)

- Fixed estimate per row style, `measureElement` on, `getItemKey` by id, overscan 6.
- The scroll container is the only element with `overflow`; rows are absolutely positioned with `translateY`, so `overflow-anchor` does not apply and the list must not accept prepends. These lists only append (paging) or replace (filter).
- Keyboard: the active index is state; `scrollToIndex(active, { align: 'auto' })` on change. Rows carry `role="row"`-style ARIA with `aria-rowindex` because the DOM does not hold them all.

## 4. Interaction

### 4.1 Activate on pointerdown

Navigation (sidebar rows, tabs, nav items, filter chips, ⌘K rows, Browse rows, thread links) runs on `pointerdown`, not `click`. The press and the open are the same frame. Rules:

- Only `button === 0`, `pointerType !== 'touch'` is irrelevant on macOS but the handler checks `isPrimary`.
- `ctrlKey` on macOS is a context-menu click: ignore it. Button 2 and the context-menu key open the menu, never navigate.
- `metaKey` opens in a new tab on `pointerdown` too; `shiftKey` and `altKey` do nothing in v1 (reserved).
- The target must not be inside a nested control (`closest('button, a, input, [data-no-activate]')`), so the Resolve button, the tab close button and rename inputs are not swallowed.
- Rows are not draggable, so there is nothing to cancel. Tabs will be reorderable later; Safari activates a tab on mousedown and still allows the drag, which is the model.
- `onClick` still exists for assistive technology, which synthesises `click` with `detail === 0`. A real click (`detail !== 0`) is ignored because `pointerdown` already activated; a touch press waits for its click. This is `activateHandlers` in `packages/ui/src/internal/activate.ts`.
- Keyboard activation is on `keydown` of Enter or Space (Space on `keyup` for `role="button"`, to match native buttons, but navigation rows use `keydown` for Enter).

### 4.2 Prefetch

- Pointer enter, focus, or keyboard selection of a sidebar row or a ⌘K result mounts that topic's `messagesAtom` through the atom registry (`useAtomMount` or a registry `mount` from the container) with `Atom.setIdleTTL(30 s)`. The engine runs the window query and keeps the subscription warm; the open becomes a cache hit and paints in one frame. No Slack call is made by a prefetch; the replies fetch starts on the real open.
- At most 3 prefetched topics are kept warm (LRU). The active tab's topic is never evicted.
- After the sidebar first paints, prefetch the lazy page chunks and the first topic in the list on idle.
- Prefetch work in the engine runs on the interactive lane's query path but must yield to a real open: a real subscription is served before any prefetch subscription in the same tick.

### 4.3 Tabs stay mounted

- The active tab and the 4 most recently active topic tabs render inside `<Activity mode="visible" | "hidden">` ([React Activity](https://react.dev/reference/react/Activity), stable in React 19.2; this repo has 19.3). Hidden tabs keep their DOM, scroll position and composer text; React destroys their effects, so their live subscriptions end and the engine stops working for them. Switching is a `display` toggle: one frame.
- `messagesAtom` has a 30 s idle TTL so a hidden tab's query is not torn down and rebuilt during a quick switch away and back.
- Tabs beyond the 5 are unmounted and keep a `ScrollSnapshot { anchorKey, offset }` in `tabsAtom`. On remount the container restores it in `useLayoutEffect` before paint.
- Every component under a tab must clean up its effects correctly; hidden means "as if unmounted". StrictMode in dev double-invokes mounts to catch this.
- Page tabs (All topics, For you, Juno, Notifications, Preferences, New message) are singletons and follow the same rule.

### 4.4 Feedback timing

- Local commands (resolve, pin, mark read, send) return in under 10 ms in the engine and the live query repaints under 50 ms, so the UI never needs an optimistic copy. Pressed state is `:active` CSS, so the press itself is instant.
- No spinner under 300 ms. Anything that can take longer uses a `delay={300}` indicator; a plain text line ("Loading older messages") is preferred to a spinner, and a global spinner never exists.
- Skeletons only where the geometry is known and the content is genuinely unknown (a never-synced topic). A skeleton must have the final height of what it replaces; otherwise show nothing.
- Content that arrives late never moves what the user is reading. Reserve space (images, avatars, cards), insert above the viewport under scroll anchoring, or add below the fold.
- The theme switch, tab switch and filter change show the finished state in one frame, never an intermediate empty state. Use `startTransition` so the old content stays until the new one is ready.

### 4.5 Scroll restoration

- Each tab records `{ anchorKey, offset }` on `scrollend` (debounced by the browser). Restoring uses the anchor row's position after mount, before the first paint.
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

- ⌘K: the input is local state; `useDeferredValue(query)` feeds `searchAtom`, and results render inside the deferred value so typing is never blocked ([useDeferredValue](https://react.dev/reference/react/useDeferredValue)). The local FTS query has no debounce; the AI `commandParseAtom` keeps its 150 ms debounce and renders as a separate row when it arrives.
- Tab switches and theme changes are wrapped in `startTransition` ([startTransition](https://react.dev/reference/react/startTransition)) so React keeps the old UI until the new one is ready.
- A transition does not hold atom state. `useAtomValue` is a `useSyncExternalStore` subscription, and React commits those updates synchronously even inside `startTransition`, so a list whose source atom changes (a new filter's live query starts as `Initial`) renders empty until the data arrives. The atom must hold the previous value itself. The sidebar does this in `sidebarListAtom` (`@juno/state`): it keeps the window shown until the new filter's first snapshot arrives, then replaces it in one update, and rows whose `rev` is unchanged keep their objects, so only the rows that enter, leave or differ re-render. Any other list that switches its source (All topics filters, the message window on topic switch) follows the same pattern.
- Large commits (a 100-row prepend) are plain updates, not transitions: they must land in the same frame as the scroll adjustment.

### 5.4 Compiler and memo

- The React Compiler (1.0, stable) is enabled through `@vitejs/plugin-react`'s Babel options ([react.dev/learn/react-compiler](https://react.dev/learn/react-compiler)). It removes most hand-written `useMemo`/`useCallback`. Explicit `React.memo` stays on rows and messages so the rule is visible and survives a compiler bail-out.
- Any component whose render exceeds 1 ms in the React profiler for a single row is split or memoized.

### 5.5 StyleX and CSS

- StyleX has no runtime cost: `stylex.props` concatenates precomputed class names. Dynamic styles (`stylex.create` with a function) write inline CSS variables and are fine for a handful of values (avatar colour) but are not used for per-frame values.
- CSS size is the only StyleX cost. The budget is 150 KB; new variants are measured.
- Hover, press, focus and selection states are CSS pseudo-classes, never React state.

## 6. Engine

- **Indexes.** Every live query has a test that runs `EXPLAIN QUERY PLAN` against the large fixture and fails on `SCAN` of `messages`, `topic_index`, `reactions` or `topic_overlay`. Required at minimum: `topic_index(last_activity_ts DESC)`, `topic_index(channel, last_activity_ts DESC)`, `messages(channel, thread_ts, ts)`, `messages(channel, ts)` (the primary key), `reactions(channel, ts)`, `topic_reads(topic_id)`, `outbox(target_key, created_at)`, `notification_log(at)`. `messages_fts` uses `prefix='2 3'` for the palette.
- **Windows.** A query takes an anchor and a count and returns at most the window. A query that can return unbounded rows is rejected in review.
- **Deltas.** The engine keeps the last emitted `{ order, revById }` per subscription and sends only rows whose `rev` changed plus the new `order` when it differs. A run that changes nothing sends nothing, and a value equal to the last one is not sent again.
- **Reuse between runs.** A list query whose rows are expensive to shape keeps what it built for its subscription and rebuilds only rows whose inputs changed. The sidebar query (`engine/src/topics/query.ts`, `RowCache`) reuses each topic and row object while the joined columns and the people are unchanged, and keeps the users it has read until the `users` table is invalidated. On the large seed this takes a re-run from about 6 ms to about 2.5 ms; the SQL is about 1 ms of it.
- **Batching.** One writer transaction per socket event or command, wrapped in `Reactivity.withBatch`, so dependent queries re-run once. Invalidation keys are specific (`['messages', topicId]`, `['topics']`), never a global key. Backfill pages commit in 200-row transactions and `Effect.yieldNow` between them.
- **Debounce.** Leading-edge, 30 ms trailing on live query re-runs (architecture 2.6). A command's own invalidation is never delayed.
- **The event loop.** `node:sqlite` is synchronous, so statements are prepared once and small. Nothing after boot may run more than 50 ms synchronously; large JSON (a `userBoot` response) is parsed once at boot and never on the interactive path. `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `cache_size` sized for the large workspace, `busy_timeout=250`.
- **Priorities.** The `RequestQueue` already orders lanes; the query side orders too: a subscription that belongs to the active tab or a user command runs before prefetch and background invalidations.
- **Engine timing on the wire.** Every live query message carries `meta: { queryMs, encodeMs, seq }` so the renderer can attribute the write-to-pixels budget without a cross-process trace.

## 7. Measuring

### 7.1 Instrumentation in the app

- `@juno/state/perf.ts` wraps `performance.mark` and `performance.measure` with a fixed set of names: `juno.start`, `juno.shell-paint`, `juno.sidebar-rows`, `juno.topic-open`, `juno.tab-switch`, `juno.filter`, `juno.palette-open`, `juno.palette-results`, `juno.send`, `juno.live-update`. Each measure sets `detail.devtools` so it shows as a "Juno" track in the Chrome DevTools performance panel ([DevTools extensibility API](https://developer.chrome.com/docs/devtools/performance/extension)).
- The write-to-pixels measure starts from the engine's `meta.seq` timestamp (shared clock, `nowAtom`) and ends in a `requestAnimationFrame` plus `setTimeout(0)` after the commit, which is the first moment the frame has been presented.
- A `PerformanceObserver` for `long-animation-frame` (threshold 50 ms, `blockingDuration`, `scripts[].sourceURL`) and for `event` with `durationThreshold: 16` runs always, and the counters are always on `window.__juno.perf` (`apps/desktop/src/renderer/main.tsx`), so tests and DevTools can read them in any build.
- React's Performance Tracks appear in dev builds ([React 19.2 release notes](https://react.dev/blog/2025/10/01/react-19-2)); use them to find which component owns a long frame.

### 7.2 Tools

| Need | Tool |
| --- | --- |
| Frame-level trace of the renderer in a test | Playwright: `page.context().newCDPSession(page)` then `Tracing.start` with `devtools.timeline`, `disabled-by-default-devtools.timeline.frame`, `blink.user_timing`, `v8.execute`; `Tracing.end` and read `dataCollected` ([Playwright Electron](https://playwright.dev/docs/api/class-electron), [CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)). Playwright's own `context().tracing` works too but is coarser. |
| Slow the CPU to match CI | CDP `Emulation.setCPUThrottlingRate` on the renderer page. |
| Counts without a trace | CDP `Performance.getMetrics`: `JSHeapUsedSize`, `Nodes`, `LayoutCount`, `RecalcStyleCount`. |
| Trace across main, renderer and engine | `contentTracing.startRecording({ included_categories: [...] })` from main; `stopRecording` returns the file path ([contentTracing](https://www.electronjs.org/docs/latest/api/content-tracing)). |
| Memory and CPU per process | `app.getAppMetrics()` (the engine shows under its `serviceName`; `cpu` is since the last call; memory in KB) and `process.getProcessMemoryInfo()` inside a process, using `private` on macOS ([app](https://www.electronjs.org/docs/latest/api/app), [process](https://www.electronjs.org/docs/latest/api/process)). |
| Engine query timing | The `meta.queryMs` field, and the engine benchmark in `packages/engine/test/bench`. |
| By hand | `pnpm dev`, open DevTools, record the Performance panel while repeating the interaction 5 times. Read the Juno track, the React tracks and the LoAF entries. |

### 7.3 The perf harness

Status: the fixture and the engine benchmark exist; the Playwright harness does not. `scripts/check-bundle-size.mjs` runs in `pnpm build`, the marks live in `@juno/state/perf`, `largeSeed()` in `@juno/fake-slack` is the fixture below (generated in about 5 s, never checked in), and `packages/engine/test/bench` boots the engine on it and reports the sidebar query time alone and inside the engine, the snapshot and delta sizes, the encode, clone and decode times and the inject-to-row time, with the load average (`JUNO_BENCH=1`). On Apple silicon the first run after an idle gap is about twice as slow as the same run on a busy CPU (power management), so `meta.queryMs` after an injected event is higher than the isolated time even on a quiet machine. First numbers are in `docs/architecture.md` section 16, M3. The rest of this section is the plan.

Location: `apps/desktop/perf/`, a separate Playwright project `perf` (`pnpm perf`, `pnpm perf:baseline`). It is not part of `test:e2e`, because it needs a quiet machine and a longer timeout.

**Fixture.** `fake-slack` gains a deterministic `large` seed: 300 channels (60 private, 40 DMs, 20 group DMs), 2 000 users, 5 000 topics, 100 000 messages spread over 30 days with 15 % attachments (image dimensions included), 5 % code blocks, reactions on 20 %, 10 % unread. Generating it takes seconds; the resulting `cache.db` and `user.db` are built once per seed hash and cached under `perf/.cache/`, so cold-start scenarios measure Juno, not a sync.

**Driver.** Scenarios are written with the same typed user-language driver the e2e tests use, so they read as plain steps: `await juno.sidebar.open('Pricing page copy')`, `await juno.tabs.switchTo('#eng')`, `await juno.palette.type('maya')`, `await slack.as('Dev').replyIn('Pricing page copy', 'done')`. The driver exposes `juno.perf.measure(name)` which reads the matching `performance.measure` from `window.__juno.perf`. A scenario that cannot be expressed in the driver is a sign the driver is missing a verb, not a reason to script the DOM.

**Scenarios** (one file each): `cold-start`, `warm-start`, `topic-open-cached`, `topic-open-uncached`, `topic-open-prefetched`, `tab-switch`, `filter-change`, `palette`, `composer-typing`, `send`, `scroll-sidebar`, `scroll-messages`, `live-update` (the fake injects 50 events in 2 s while a topic is open), `prepend-no-shift`, `memory-soak`. Each defines a warmup count (2), a measured count (7), the metric names and their budgets from section 1.

**Stability.**

- Fixed window size 1 200 × 800, `prefers-reduced-motion: reduce` emulated for everything except the scroll scenarios, the fake on a local port, no DevTools open, Playwright workers 1.
- Report the median and p95 of the 7 runs. The build compares the median to the baseline and the p95 to the budget.
- If the coefficient of variation of a scenario exceeds 10 %, rerun it once; if still noisy, mark it `unstable` in the report rather than fail.
- CI (`macos-26` runner) is slower and noisier than a dev Mac, so baselines are stored per host class: `dev-apple-silicon` and `ci-macos-26`. Budgets for `ci-macos-26` are the section 1 numbers times 2.0. Locally, `pnpm perf --throttle 4` applies 4× CPU throttling through CDP to approximate CI when needed.
- Cold start on CI drops the OS file cache by running the scenario first with a fresh user-data copy; the first run is the warmup and discarded.

**Failing the build.** A scenario fails when its p95 exceeds the host's budget, or its median exceeds the stored baseline median by more than 15 %, or a memory soak grows more than 5 % across repetitions, or the bundle check in `scripts/check-bundle-size.mjs` exceeds section 1. Failures print the scenario, the step, the numbers, and the path to the saved CDP trace.

**Baselines.** `apps/desktop/perf/baselines.json` is committed: `{ host, scenario, metric, median, p95, commit, date }`. `pnpm perf:baseline` rewrites it from a fresh run and is only used in a PR whose description says why the numbers changed (new feature, intentional trade-off, hardware change). On every merge to `main` CI appends the run to `perf-history.ndjson` on the `perf-data` branch and uploads the traces as artifacts for 30 days, so a slow drift is visible even when each step stays under 15 %.

### 7.4 Review checklist for any UI, list, IPC, query or startup change

1. Does the interaction paint on the next frame? Trace it once.
2. Does the change add work to scroll, to a tick, or to every row? If so, measure the scroll scenario.
3. Does anything new run before the first sidebar paint? It must be on the deferred list or justified.
4. Does the query have an index and a window? Run the plan test.
5. Does a live query message grow? Check the size budget.
6. Did memory or bundle size move? Check the report.

## 8. Known gaps

- `content-visibility: auto` makes the scrollbar an estimate until rows have been rendered once. With `auto` sizing and a good per-style estimate this is invisible in practice; the scroll scenario checks that the scrollbar thumb does not jump more than 2 px during a page-down.
- The LoAF observer attributes scripts only on the main thread; engine stalls show up as late `live-update` measures instead.
- `app.getAppMetrics()` reports working set, which overstates shared memory; the private figure from inside each process is the one the budget uses.
- CDP sessions on Electron pages are not documented by Playwright but work because the page is a Chromium target; if a Chromium upgrade breaks them, the `contentTracing` path is the fallback.
