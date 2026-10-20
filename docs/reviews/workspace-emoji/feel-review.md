# Workspace emoji verification

Checked on 2026-10-20 on an Apple M2 Mac, after the review fixes. Workspace remains after the standard categories.

The five requested regression checks failed before their fixes: wheel scrolling unmounted the focused cell; search preferred a workspace prefix over a standard alias; a failed image removed its cell; a saved Settings alias was not marked chosen; and the cold picker’s first visible Frequently used row omitted the custom quick reaction. The cold check used 20,000 entries. These are now covered by the gallery and fake-Slack desktop flows.

The gallery passed eight behavior checks: light and dark Workspace order, lazy image loading, focus through wheel scrolling and arrows, Escape, failed-image geometry, exact-match Enter, alias-aware selection in browse mode, standard-target aliases and distinct image/standard picks for a colliding name. The fake-Slack reaction flow passes with raw image URLs, a name and alias pick sent to `reactions.add`, and a loaded reaction-chip image. The first-paint and remaining Settings/Juno flows passed their focused runs.

`pnpm test:feel -g 'react to a Juno bubble'` passed four checks over 46 recorded frames. The quick reactions appear at their anchor from frame 6, and the badge arrives without moving the bubble. The recording lasts 739 ms at load 7.2; no layout shift or flicker appears in the inspected filmstrip. This scenario uses standard reactions; the desktop spec covers custom badge images.

The refreshed screenshots show the full picker scrolled to Workspace, with eight distinct images and one alias:

- `/Volumes/AgentWork/juno-workspace-light.png`
- `/Volumes/AgentWork/juno-workspace-dark.png`

The final 20,000-image benchmark passed ten cold opens: **42.8 ms median, 44.9 ms p95**, range 41.1–44.9 ms, load 4.5. These use the repository’s nearest-rank statistics. Every image URL is distinct; the seed’s alias is additional to the 20,000 image owners. The mounted cell count stays below 200.

Each sample uses a new renderer, lets process startup settle for 500 ms on Home, and verifies that no emoji subscription has started. It clears and disables the browser image cache, holds fake image bodies until the click, and opens Add reaction just after Settings first paints. Timing starts at the earlier of the click and the cold subscription. A ready subscription before the click rejects the sample. Timing ends after the first frame containing six loaded visible custom images; those URLs must have been requested. The run also checks Workspace scrolling, focus after wheel scrolling and searching the final entry.

SQLite emits the table JSON directly; state validates it with the contract schema and a generated static decoder. Canonical names use the sorted data, aliases use a small lookup, and Juno badges resolve only their displayed names. Sorting, search keys and alias data are cached per table change. The picker creates cell slices only for mounted rows and retains its focused row. Its first paint waits for complete data and its snapshot stays fixed while open.

The checked desktop bundle is 1,099.5 KB JS and 151.4 KB CSS, within the existing budgets. The renderer CSP is unchanged; only fake-Slack test contexts bypass CSP for the local image origin. The static decoder generator is checked by lint against the schema and pinned Effect.

`pnpm affected` ran once. Its selective remote unit run passed 1,447 tests (eight skipped), and desktop passed 72 checks (three skipped). Gallery passed 283 checks and failed one shift walk because the regression fixture’s callback outputs grew after a pick. Lint also found unused exports and an oversized benchmark callback.

Those issues are fixed. The fixture’s accessible feedback is outside layout; a focused local run passed 62 gallery checks, including every picker regression and the shift walk. Final local lint passes all 12 checks and the Bun typecheck passes. The original affected invocation remains a failed run; it was not repeated.

The name validation evidence and its limits are recorded in [Slack emoji names](../../research/slack-emoji-names.md). Public Slack documentation does not define the full character alphabet. The boundary now accepts lowercase Unicode letters, marks and numbers plus `+_-`; no live workspace write was used to test names.
