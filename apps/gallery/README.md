# Gallery

Browser-only fixtures for primitives, views and compositions. No Slack session or Electron is needed.

- `bun run gallery`: interactive review on port 4174.
- `bun run test:gallery`: cache checks, build, then parallel Chromium behavior tests with zero retries.
- `GALLERY_SHIFT_ALL=1 bun run test:gallery`: refresh every selected shift and focus state, even if cached.
- `bun run remote --env GALLERY_SHIFT_ALL=1 test:gallery`: the same full check on the runner.
- `bun run gallery:shots`: review screenshots in both themes. `GALLERY_SHOTS_ONLY=Button` narrows them.

Install the pinned headless shell with `bunx playwright install chromium --only-shell`. Each test run chooses its own preview port. `GALLERY_WORKERS` controls concurrency. Every test owns one context; long walks reset the document between states and recycle pages every 20 states. Screenshots remain review artifacts, not pixel baselines in the behavior gate.

## Cached walks

`walk-cache.mjs` uses the repository import graph to hash a component's fixture and transitive workspace imports. Shared gallery code, configuration, styles, assets, fonts, tokens, test helpers and the lockfile also count. Runtime keys include Playwright, the actual browser version, OS release, architecture and browser options. Unknown registrations widen to all source. State identity includes the fixture frame settings.

Only a completed successful state is recorded. Before rechecking a state its old record is removed, so failure or interruption cannot preserve a previous pass. Records are written atomically under `$JUNO_BUILD_CACHE_DIR/gallery-walk-v1`, or the shared system temp directory's `juno-cache/results/gallery-walk-v1`. The remote runner uses `/cache/builds/gallery-walk-v1`.

`GALLERY_SHIFT_ONLY`, `GALLERY_SHIFT_PARTS`, `GALLERY_RING_ONLY`, `GALLERY_RING_PARTS` and `JUNO_SHARD` retain their meanings. `GALLERY_SHIFT_ALL=1` and `--repeat-each` bypass both caches. The queue is isolated by run, repeat, guard and retry. Targeted regression tests always run. Identical DOM is not proof of identical behavior and is never a persistent cache key.

## Spec audit, 2026-10-24

Reviewed every spec and its non-merge history. Commit counts alone do not prove usefulness; the decisions below also consider the assertion and recorded regression evidence. The history cannot establish that a test never failed in an unrecorded local run.

| Specs | Decision and evidence |
| --- | --- |
| `shift`, `focus-ring` | Keep and cache broad walks. Shift history includes real regressions, the disabled-control hang and fallback-font failures; retain injected-shift self-tests and delayed loads. |
| `activation` | Merge eight small cases into three pointer, nested-control and keyboard flows. |
| `behaviour` | Keep cursor, scroll chaining, whole-pixel row, truncation, late palette and gallery routing checks. These have specific regression history. |
| `tooltip` | Merge six checks into a timing/dismissal flow and an edge-containment check. Drive time explicitly instead of racing wall-clock sleeps. |
| `memory-edit` | Merge five cases into one edit/save/cancel flow, including the empty draft and both save keys. |
| `geometry` | Keep stable filter height, long-path truncation and count alignment. Remove fixed insets, chip dimensions, column widths and decorative alignment; 17 of its 23 commits accompanied UI changes. |
| `list-geometry` | Keep current/hovered switcher selection. Remove decorative row heights, gaps and tag baselines; 9 of 14 commits accompanied UI changes. |
| `settings` | Keep the saved-key presentation check. Remove section inventories and fixed card/nav dimensions; 5 of 10 commits accompanied UI changes, including updates to expected section names. |
| `all-topics-filters-geometry` | Keep clipping, overlap, equal control heights and the searchable place list. Remove fixed height/gap and icon-size assertions; use light for geometry. |
| `home-geometry` | Keep the syncing line's stable start as its text changes. Remove picture-caption and row-action spacing checks. |
| `attachment-geometry`, `media-geometry`, `sync-geometry`, `home-write-geometry`, `juno-panel-geometry` | Remove fixed frame, spacing and decorative placement checks. Their histories track design edits; delayed-image and narrow-window coverage remain. |
| `emoji-align`, `selection-bar-align` | Remove screenshot ink-centering probes and their unused helpers. They were introduced alongside alignment changes; interaction and keyboard checks remain. |
| `processes` | Remove fixture row-count/screenshot inventory. It tested fixed fixture contents rather than diagnostics behavior. |
| `attachment-images`, `thread-link` | Keep held-image arrival/failure checks; remove attachment pixel dimensions. |
| `emoji-picker` | Keep search, aliases, failed-image stability, focus retention and Escape regressions; remove duplicate theme screenshots. |
| `peek-contrast` | Keep browser-computed readability in both themes with two accents. Remove comparisons to the former design, screenshot capture and JSON dumps. |
| `contrast` | Keep all accents: each defines different colors and could independently break readable contrast. |
| `message-geometry` | Keep density, wrapping and absent-content rules tied to recorded regressions. Remove the pinned top gap. |
| `message-menu` | Keep edge placement and picker expansion anchors. Remove font, row, emoji and icon pixel probes. |
| `message-more` | Keep hover/focus visibility, stable rows and menu anchoring; remove unasserted screenshots and fixed button size. |
| `message-hover`, `button-press`, `trigger-open` | Keep actual hover, selection, held-press and trigger feedback checks. |
| `narrow-geometry`, `confirm-geometry`, `popover-anchor-geometry` | Keep clipping/overlap and edge-placement regressions. Narrow layouts have a series of real fixes in history. |
| `tabs-geometry`, `topic-titles`, `welcome-geometry` | Keep keyboard semantics, stable/contained geometry and wrapping. Remove fixed tab inset/title heights and duplicate light/dark geometry screenshots. |
| `sidebar-rows`, `roving`, `card-working`, `table`, `formatting`, `topic-art` | Keep behavior and regression checks: accessible state, keyboard navigation, disabled mutation, copying/wrapping, preview alignment and deferred art. |
| `shots` | Keep the review screenshot command separate from behavior tests. |
