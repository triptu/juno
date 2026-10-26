# @juno/testing

Playwright helpers shared by the gallery (`apps/gallery`) and the desktop e2e tests. Test code only: no `src` of an app or package imports it, and it depends on no other `@juno` package.

## `expectNoLayoutShift(page, action, options?)`

```ts
import { expectNoLayoutShift } from '@juno/testing/layout-shift'

await expectNoLayoutShift(page, () => row.hover())
await expectNoLayoutShift(page, () => page.mouse.down())
```

Starts a `PerformanceObserver` for `layout-shift` entries (only from the start of the action), runs the action, waits two frames and then until every transition or animation running under the root has finished (one iteration of an endless one the action started; motion that is declared but idle, or endless and already running, is not waited for), then fails if any entry has a value above 0 or any element's layout box moved or resized. An element with no box before or after (added, removed, or `display: none` on one side) is not compared, as the browser's score does not count it; whatever it pushes still is. Entries flagged `hadRecentInput` are counted too: Chromium sets that flag within 500 ms of a keypress or pointer press. Hovering alone need not set it. A `<video>`'s own controls are left out: a shift source with no node (it is in the video's shadow root) that stays inside a video's box is dropped, and an entry with only such sources counts as no shift. Chromium can also report the controls' shift with no sources at all (seen with a video whose source failed to load), so while a video with controls is under the root, or was when the action started, an entry with no sources counts as no shift; the box comparison still covers every page element.

The box comparison reads `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight` of every HTML element under the root, relative to the root. Those ignore transforms, so the press scale (or any scale, translate or opacity effect) is not counted, while a change of size, padding, border or position is. Elements are compared to themselves, so nothing needs to be excluded.

Options: `root` (default the gallery's `[data-fixture-frame]`, else `body`), `settleMs` (extra wait), `tolerance` (px, default 0.5; offsets are whole pixels, so any change counts) and `motion`. `motion: 'layout'` waits only for transitions and animations of a property that can move a box; a colour, opacity, shadow, filter or transform change cannot, so a hover's colour fade or the press scale is not waited out. The gallery uses it, where every touch starts such fades and nothing else lands while they run. The default, `all`, waits for every one, which also gives late data in the app time to land.

`measureLayoutShift` returns the report without throwing; `formatLayoutShiftReport` renders it, and `layoutShiftError` turns a report into the error `expectNoLayoutShift` throws.

## `watchLayoutShift(page, options?)`

```ts
const watch = await watchLayoutShift(page, { motion: 'layout' })
const hover = await watch.check(() => page.mouse.move(x, y), { pending: '[data-chunk-pending]' })
const press = await watch.check(() => page.mouse.down())
await watch.stop()
```

The same guard over a sequence of actions. Each `check` runs its action, waits as `expectNoLayoutShift` does and reports what shifted since the previous check (or since the watch started). The observer stays connected, and a check's last box snapshot is the next one's first, so N actions take N + 1 snapshots and one page call each besides the action, where separate guards take 2N snapshots and three calls. Anything that moves between two checks is charged to the second, so nothing is missed between them. `pending` is a selector of a marker for code still loading: the check first waits, up to 15 s, until none is left. `rebase` measures from now, after something that is allowed to move the layout (a scroll that lays out rows). A new watch, or `measureLayoutShift`, replaces the page's current watch.

Chromium only (the `layout-shift` entry type); the box comparison runs anywhere.

## `checkForcedInteractions(page, options)` (`@juno/testing/forced-shift`)

The fast tier of the same guard, used on changed gallery states in normal runs and every state at night. Run it on a dedicated page: it rewrites the document’s styles and suppresses click defaults for that document’s lifetime. In one `page.evaluate` it rewrites `:hover`, `:active`, `:focus`, `:focus-visible` and `:focus-within` in the loaded sheets into attribute selectors of the same specificity, turns transitions off and, for each element matching `targets` (at most `max`, default 8: the first ones and the last three), hovers, focuses from the keyboard, blurs, presses, releases and leaves. It sets the attributes where the browser would match the pseudo-classes, dispatches the pointer, mouse, key and focus events React listens to, waits two tasks through one MessageChannel owned by the check, waits for `pending` code to load and finishes animations the touch started. It closes the channel on success or failure. Forced focus attributes are tracked for that check and updated only where focus or keyboard modality changes. After each step it compares every box under the root with the same comparison as `expectNoLayoutShift` (`tolerance`, `grows`). `skipWithin` leaves alone what is inside its matches. When a touch removes or hides elements still to touch it returns `next`: open the state again and call with `from: next`. `formatForcedShift` renders a shift in the guard's report format.

It cannot see a shift that exists only while a transition runs, one that waits for an animation frame or a ResizeObserver, or browser defaults of real input other than focus on press. Run `expectNoLayoutShift` with real input for those.

## `waitForLayoutReady(page)`

After the expected UI and data are visible, wait for `document.fonts.ready` and two animation frames before starting a layout-shift measurement. This lets the font layout and earlier UI changes paint outside the interaction being measured. It does not wait for application data or stop animations.

```ts
import { expectNoLayoutShift, waitForLayoutReady } from '@juno/testing/layout-shift'

await row.waitFor({ state: 'visible' })
await waitForLayoutReady(page)
await expectNoLayoutShift(page, () => row.hover())
```
