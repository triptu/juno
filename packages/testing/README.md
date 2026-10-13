# @juno/testing

Playwright helpers shared by the gallery (`apps/gallery`) and the desktop e2e tests. Test code only: no `src` of an app or package imports it, and it depends on no other `@juno` package.

## `expectNoLayoutShift(page, action, options?)`

```ts
import { expectNoLayoutShift } from '@juno/testing/layout-shift'

await expectNoLayoutShift(page, () => row.hover())
await expectNoLayoutShift(page, () => page.mouse.down())
```

Starts a `PerformanceObserver` for `layout-shift` entries (only from the start of the action), runs the action, waits two frames plus the longest transition or animation declared under the root, then fails if any entry has a value above 0 or any element's layout box moved or resized. Entries flagged `hadRecentInput` are counted: Chromium sets that flag within 500 ms of any input, which is when hover and press shifts happen.

The box comparison reads `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight` of every HTML element under the root, relative to the root. Those ignore transforms, so the press scale (or any scale, translate or opacity effect) is not counted, while a change of size, padding, border or position is. Elements are compared to themselves, so nothing needs to be excluded.

Options: `root` (default the gallery's `[data-fixture-frame]`, else `body`), `settleMs` (extra wait) and `tolerance` (px, default 0.5; offsets are whole pixels, so any change counts).

`measureLayoutShift` returns the report without throwing; `formatLayoutShiftReport` renders it.

Chromium only (the `layout-shift` entry type); the box comparison runs anywhere.
