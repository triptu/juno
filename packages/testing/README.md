# @juno/testing

Playwright helpers shared by the gallery (`apps/gallery`) and the desktop e2e tests. Test code only: no `src` of an app or package imports it, and it depends on no other `@juno` package.

## `expectNoLayoutShift(page, action, options?)`

```ts
import { expectNoLayoutShift } from '@juno/testing/layout-shift'

await expectNoLayoutShift(page, () => row.hover())
await expectNoLayoutShift(page, () => page.mouse.down())
```

Starts a `PerformanceObserver` for `layout-shift` entries (only from the start of the action), runs the action, waits two frames and then until every transition or animation running under the root has finished (one iteration of an endless one; motion that is declared but idle is not waited for), then fails if any entry has a value above 0 or any element's layout box moved or resized. Entries flagged `hadRecentInput` are counted too: Chromium sets that flag within 500 ms of a keypress or pointer press. Hovering alone need not set it.

The box comparison reads `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight` of every HTML element under the root, relative to the root. Those ignore transforms, so the press scale (or any scale, translate or opacity effect) is not counted, while a change of size, padding, border or position is. Elements are compared to themselves, so nothing needs to be excluded.

Options: `root` (default the gallery's `[data-fixture-frame]`, else `body`), `settleMs` (extra wait) and `tolerance` (px, default 0.5; offsets are whole pixels, so any change counts).

`measureLayoutShift` returns the report without throwing; `formatLayoutShiftReport` renders it.

Chromium only (the `layout-shift` entry type); the box comparison runs anywhere.

## `waitForLayoutReady(page)`

After the expected UI and data are visible, wait for `document.fonts.ready` and two animation frames before starting a layout-shift measurement. This lets the font layout and earlier UI changes paint outside the interaction being measured. It does not wait for application data or stop animations.

```ts
import { expectNoLayoutShift, waitForLayoutReady } from '@juno/testing/layout-shift'

await row.waitFor({ state: 'visible' })
await waitForLayoutReady(page)
await expectNoLayoutShift(page, () => row.hover())
```
