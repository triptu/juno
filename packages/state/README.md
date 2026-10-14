# @juno/state

The renderer's bridge to the engine: the port client and every atom. The only package that imports `effect/reactivity` Atom and `@effect/atom-react`, and the only place the renderer touches `effect/rpc` and `effect/workers`. See `docs/architecture.md` section 7.

## Public API

- `liveQuery(route)(payload)`: an atom for a stream route. A `liveValueRoute` gives the latest value; a `liveListRoute` gives a `ListWindow` kept by `applyListDelta`, with `rowAtom(list)(id)` for per-row subscriptions. Memoized per route. The atom keeps its subscription for a 30 s idle TTL after the last reader leaves.
- `applyListDelta`: rows with an unchanged `rev` keep their objects, across a `reset` too (a reconnect re-renders only what changed); `order` keeps its array when equal. The delta's `refs` (the people, channels and topic art rows name by id, architecture 7) go into `window.refs.people`, `window.refs.channels` and `window.refs.art` before the rows; a ref that arrives equal to the one held keeps its object, and a delta without refs keeps the maps.
- `command(route)`: a writable atom that runs the command and exposes its `AsyncResult`. It runs one call at a time: a second write interrupts the first, so per-row actions use `runCommand(registry, route, payload)`, which gives each call its own atom.
- `prefetch(registry, atoms)`: warms one or more queries as one entry (hover, focus, keyboard selection). One warm set per registry, at most three entries; it holds the subscriptions under the atoms, not the atoms, so an evicted prefetch that was never opened ends at once. An open topic reads the atoms themselves and is never evicted.
- `registry`, `makeRegistry()`, `configureConnection(registry, { acquire })`, `connectionStateAtom`, `acquireRendererPort`: the client and its connection. Tests make their own registry. `restartEngine(registry)` asks main to start the engine again after its supervisor gave up (`failed`); the transport keeps asking for a port and connects once one comes.
- Feature atoms, declared once at module level in `src/<feature>.ts`: `engineStatusAtom`, `pingCommand`, `appInfoAtom`, `themeAtom`, `persistTheme`, `sessionStatusAtom` and `signedInAtom` (the last ready session, held while the engine restarts so the shell stays up), `topicListAtom(filter)` (one filter's window, with each wire row's channel and people joined from the refs into the `TopicRow` the views take; a joined row keeps its object while its wire row and what it names keep theirs), `topicCountsAtom(scope)`.
- Topic view atoms in `src/messages.ts`:
  - `messagesAtom(id, window)`, `topicAtom(id)` (`TopicDetail | null`) and `channelThreadsAtom(channel)`: the live queries.
  - `messageWindowSpecAtom(id)`: the window a tab wants (`{ anchor?, before?, limit }`, the bottom 150 by default). The container writes it.
  - `messageListAtom(id)`: the window shown. When the spec changes it keeps the old window until the new one's first snapshot arrives, then swaps in one update; rows with an unchanged `rev` keep their objects.
  - `messageOrderAtom(id)` (the ids, for the list container; equal ids do not notify) and `messageItem(id, ts)` (one message with its sender joined from the refs; notifies only when either changes).
  - `openTopic(registry, id)`, `loadOlderMessages(registry, id, before)`: the commands that call Slack. `prefetchTopic(registry, id)` warms the header and the window a tab would show, as one prefetch entry, with no Slack call.
- Tabs in `src/tabs.ts` (spec section 6, inventory 4, performance 4.3):
  - A `Tab` has its own id, a `pinned` flag, and a `history` of `Place`s (a topic or a New chat) with the index it shows. The pure rules over `Tabs` (`{ tabs, active, recent, closed }`): `openPlace` (the current tab as a new history entry, or a new tab after it with `newTab`; a topic another tab shows focuses that tab), `stepHistory` and `goToEntry` (Back, Forward, the history menu), `historyTarget`, `closeTab`, `closeOtherTabs`, `closeTabsToRight` and `closeAllTabs` (the bulk closes leave pinned tabs), `reopenClosedTab` (⌘⇧T, a stack of 20), `setPinned`, `activateTab`, `cycleTab`, `tabByNumber` (⌘1 to ⌘9), `mountedTabs` (the active tab and the 4 most recent), `dividerIndex(order, lastReadTs)`, `parseTabs`.
  - `tabsAtom`: the signed-in workspace's tabs, read back from the `tabs` workspace preference after a restart (each tab with the place it shows; history and the reopen stack are in memory only). `updateTabs(registry, rule)` applies a rule and saves the result; nothing else changes them.
  - `tabStripAtom`: the tabs with their `TopicDetail`, for the strip and its unread dot. `historyStateAtom`: whether the active tab can go Back and Forward. `scrollSnapshotAtom(topicId)`: where a topic was scrolled, kept while the app runs.
- `slackLink(workspaceUrl, topic)` in `src/links.ts`: a topic's Slack link, built with no API call.
- Sidebar state in `src/sidebar.ts`, none of it persisted. The list container and its rows read only these:
  - `sidebarFilterAtom` (kind, unread, scope) and `selectedTopicAtom`.
  - `sidebarListAtom`: the window shown, a `SidebarWindow` (`ListWindow<TopicRow>` plus the `filter` it belongs to). After a filter change it keeps the old window until the new filter's first snapshot arrives, then replaces it in one update, never with an empty list in between. A row whose `rev` is unchanged keeps its object across the swap.
  - `sidebarSectionsAtom`: `{ ready, pinned, recent, total, filter }`, the shown window's ids split into Pinned and Recent. Equal splits do not notify. Use its `filter`, not `sidebarFilterAtom`, to pick the empty state.
  - `sidebarRowAtom(id)`: one row, keyed by id alone, so a row keeps its atom and its component across filters and notifies only when its object changes.
  - `focusedTopicAtom`: the row that had focus last. The list container sets it when a row gets focus.
  - `topicSelectedAtom(id)` and `currentRowAtom(id)`: booleans for "selected" and "takes Tab focus" (the row focused last while it is shown, else the selection while it is shown, else the first row). Only the rows whose answer changes are notified.
  - `sidebarDotAtom('channels' | 'dms')`: whether that filter shows a dot, from the counts of the current scope, as a boolean.
  - `nowAtom`: wall-clock milliseconds, refreshed on each minute boundary while something reads it. Read it through a selector that returns the label, `useAtomValue(nowAtom, (now) => relativeTime(at, now))`, so a tick re-renders only rows whose label changed.
- Topic art in `src/art.ts`: `topicArtAtom(id)`, the recipe of a topic's drawing or `undefined` for the placeholder, from the sidebar row when it is shown (no extra subscription) and otherwise from the topic's header value; it notifies only when the recipe changes. `redrawTopic(registry, id)` runs `art.redraw`. A sidebar row's `art` is joined from `refs.art` in `topicListAtom`; an empty recipe (AI assist off) joins as no art.
- `@juno/state/react`: `useAtomValue`, `useAtom`, `useAtomSet`, `useAtomRefresh`, `RegistryContext`. Containers import hooks only from here.
- `@juno/state/perf`: the fixed performance marks and `observeFrames()`. `juno.live-update` is measured for every live message and replaces the previous entry, so the buffer holds the latest one only.

Transport errors are retried every second and never reach an atom. Route errors reach it typed.

## Must not

- Contain JSX or import React components. Only the hooks module touches React.
- Use the DOM lib. It must typecheck without it because the engine's tests import it; reach browser globals through `globalThis` with local types.
- Import `@juno/engine` or `@juno/views`. It depends on `@juno/contract` only.
- Be bypassed: nothing outside the allow-list imports Atom, `effect/rpc` or `effect/workers` (`check-deps` enforces it).

## Testing

`pnpm --filter @juno/state test` covers `applyListDelta` (identity of unchanged rows, order, removal, reset, refs), the read rule and the tab rules. The topic view atoms are tested end to end in `packages/engine/test/messages.test.ts`. The client and helpers are tested end to end in `packages/engine/test/protocol.test.ts`, and the sidebar atoms in `packages/engine/test/sidebar-state.test.ts`; both use a registry per test and a Node `MessageChannel` in place of the renderer's port.
