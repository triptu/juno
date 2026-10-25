# Gallery

Browser-only fixtures for primitives, views and compositions. No Slack session or Electron is needed.

- `bun run gallery`: interactive review on port 4174.
- `bun run test:gallery`: cache checks, build, then parallel Chromium behavior tests with zero retries.
- `GALLERY_SHIFT_ALL=1 bun run test:gallery`: refresh every selected shift state, even if cached.
- `bun run remote --env GALLERY_SHIFT_ALL=1 test:gallery`: the same full check on the runner.
- `verify:main --nightly` and `verify:main --no-cache` force the broad walk automatically.
- `bun run gallery:shots`: review screenshots in both themes. `GALLERY_SHOTS_ONLY=Button` narrows them.

Install the pinned headless shell with `bunx playwright install chromium --only-shell`. Each test run chooses its own preview port. `GALLERY_WORKERS` controls concurrency. Every test owns one context; long walks reset the document between states and recycle pages every 20 states. Screenshots remain review artifacts, not pixel baselines in the behavior gate.

## Fast sweep

`computed-shift.spec.ts` checks the walk's touches in every state with forced pseudo-class styles and synthetic events, about a tenth of the walk's time a state. It runs with `GALLERY_SHIFT_COMPUTED=1`; its self-tests always run. See [the layout-shift guard](../../docs/development.md#the-layout-shift-guard).

## Cached walks

`walk-cache.mjs` uses the repository import graph to hash a component's fixture and transitive workspace imports, plus the gallery shell, its styles, assets and fonts. Tokens count by value: only the layout tokens the state's files read, in every theme; colour and shadow tokens, comments, and paint-only CSS declarations do not count (`layout-tokens.mjs`). The walk counts through `shift-walk.ts` and its imports, which include `open-state.ts` and the guard; the spec's other tests, the scaffolding in `support.ts` and the Playwright config do not. Compositions and test fixtures key on `compositions.tsx` or `testFixtures.tsx` and what it imports, so editing one re-walks only its states and a change outside the gallery's packages re-walks none. Locked versions count only for packages the gallery imports or builds with. Runtime keys include Playwright, the actual browser version, OS release, architecture and browser options. Unknown registrations widen to all source. State identity includes the fixture frame settings.

Only a completed successful state is recorded. Before rechecking a state its old record is removed, so failure or interruption cannot preserve a previous pass. Records are written atomically under `$JUNO_BUILD_CACHE_DIR/gallery-walk-v1`, or the shared system temp directory's `juno-cache/results/gallery-walk-v1`. The remote runner uses `/cache/builds/gallery-walk-v1`.

`GALLERY_SHIFT_ONLY`, `GALLERY_SHIFT_PARTS` and `JUNO_SHARD` retain their meanings. `GALLERY_SHIFT_ALL=1` and `--repeat-each` bypass the cache. The queue is isolated by run, repeat, guard and retry. The shift walk budgets three seconds per selected state across its active workers, with a 20-minute minimum for a full walk (15 minutes for a component selection). Each state, including its document reset, still has a 30-second limit. Playwright owns context teardown. Targeted regression tests always run. Identical DOM is not proof of identical behavior and is never a persistent cache key.

## Cached rendering tests

A test that only reads what states draw uses `layoutTest` (boxes, text, attributes) or `paintTest` (colours too) from `support.ts` instead of `test`. Each records which components it opened, from the page's navigations (`#index` for the list of states). It is skipped while its title, its spec and what that imports, the runtime, and the keys of those components are unchanged since it last passed. Component keys are the walk's: `layoutTest` ignores colour tokens and paint-only CSS like the shift walk; `paintTest` counts the colour and shadow tokens the component's files read and every CSS declaration, so contrast checks rerun only when a colour they resolve, or the component, changes. `#index` keys on the registries and fixture code, so a state list built from a constant outside fixture code is missed until a full run. `GALLERY_SHIFT_ALL=1` (nightly and no-cache runs), repeats and retries run every cached test. Interaction timing, motion, delayed loads, keyboard flows and the guard's self-tests stay on plain `test` and run every time.

Tests that open the same states share one test and one document: a page load costs about 0.45 CPU-s, a state opened by its hash in an open document about 0.03 (both measured on the runner, 10-25). Contrast is one test per theme over every accent.

`GALLERY_CPU=1` (Linux) prints CPU-seconds, summed test time and span per spec file (`scripts/gallery-cpu-reporter.mjs`).

Measured full and cached timings, including the interrupted Mac comparison, are in [development notes](../../docs/development.md#gallery-measurements-2026-10-24); the cached rendering tests in [Gallery CPU per spec](../../docs/development.md#gallery-cpu-per-spec-2026-10-26).

## Spec audit, 2026-10-24

Reviewed every spec and its non-merge history. Commit counts alone do not prove usefulness; the decisions below also consider the assertion and recorded regression evidence. The history cannot establish that a test never failed in an unrecorded local run. A second review the same day checked these claims against the code and recorded a verdict per file in `docs/reviews/2026-10-24-e2e-alignment.tsv`.

| Specs | Decision and evidence |
| --- | --- |
| `shift` | Keep and cache the broad walk. Shift history includes real regressions, the disabled-control hang and fallback-font failures; retain injected-shift self-tests and delayed loads. Size checks run in light only, and the header band and Resolve button are checked against each other, not against pinned pixels. |
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
| `emoji-picker` | Keep search, aliases, failed-image stability, focus retention and Escape regressions as one search-and-pick flow; remove duplicate theme screenshots. |
| `peek-contrast` | Keep browser-computed readability in both themes with two accents, one cached test per theme. Remove comparisons to the former design, screenshot capture and JSON dumps. |
| `contrast` | Keep all accents: each defines different colors and could independently break readable contrast. One cached `paintTest` per theme covers the row levels and the @you chip. |
| `message-geometry` | Keep density, wrapping and absent-content rules tied to recorded regressions, and that the first row holds while older messages load. Remove the pinned top gap. |
| `message-menu` | Keep edge placement and picker expansion anchors. Remove font, row, emoji and icon pixel probes. |
| `message-more` | Keep hover/focus visibility, stable rows and menu anchoring; remove unasserted screenshots and fixed button size. |
| `message-hover`, `button-press`, `trigger-open` | Keep actual hover, selection, held-press and trigger feedback checks. |
| `narrow-geometry`, `confirm-geometry`, `popover-anchor-geometry` | Keep clipping/overlap and edge-placement regressions. Narrow layouts have a series of real fixes in history. |
| `tabs-geometry`, `topic-titles`, `welcome-geometry` | Keep stable/contained geometry and wrapping. Remove fixed tab inset/title heights and duplicate light/dark geometry screenshots. The room kept after Welcome's Hide is checked in desktop `welcome.spec.ts` on the real Hide. |
| `sidebar-rows`, `card-working`, `table`, `formatting`, `topic-art` | Keep behavior and regression checks: disabled mutation, copying/wrapping, preview alignment and deferred art. Right-to-left caret placement is checked in desktop `formatting.spec.ts`. |
| `shots` | Keep the review screenshot command separate from behavior tests. |

### Accessibility-only tests removed, 2026-10-25

At Tushar's request the gallery no longer checks accessibility alone: `roving.spec.ts` (Tab stops and radio groups), `focus-ring.spec.ts` (focus rings never clipped, with its walk and cache kind), the tab strip's close-button and Tab-stop tests, the sidebar row's accessible description, the table scroll box's Tab stop, and single steps that asserted only an `aria-*` attribute, `tabindex` or an accessible name. `contrast.spec.ts` and `peek-contrast.spec.ts` stay: they guard the readable text levels in both themes and every accent, which `SPEC.md` sets as a design rule.

On 10-26 the geometry, contrast and static view checks above (`narrow`, `message`, `confirm`, `popover-anchor`, `all-topics-filters`, `welcome`, `tabs`, `home` and `geometry` specs, `topic-titles`, `message-menu`, `trigger-open`, the static parts of `behaviour` and `sidebar-rows`) became cached rendering tests, and tests that opened the same states were merged. No assertion was removed. `button-press`, keyboard, hover-timing, scroll and delayed-load checks run every time.
