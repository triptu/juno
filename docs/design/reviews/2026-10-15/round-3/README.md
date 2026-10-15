# Design review 2026-10-15, round 3

Two items from the owner, on `design-review-1015-3`. `compare/` stacks main (top) over this branch (bottom) in light and dark; `gallery/` holds the new narrow MessageList states. Measurements are in `../harness/out-round-3/` (`insets-*.json` give each field's and control's distance from its card's edges).

## Add a server

The Name and Address fields were 159px wide in a 656px card: the form inside the row (`cell.field`) sat in the row's horizontal body without growing, so it shrank to its placeholders and the address placeholder was cut off. The T3 Code address field had the same cause (304px). The form now takes the row's width.

While measuring, every Settings row turned out to have 14px of padding at its start and 10px at its end, so text started 15px inside the card and trailing controls ended 11px from the other edge. The `settings` ListRow preset is now 14px at both ends.

Measured at 1400 × 900 after the change:

| Row | Left | Right | Width |
| --- | --- | --- | --- |
| Add a server: Name, Address | 15 | 15 | 626 of 656 |
| T3 Code: address | 15 | 15 | 626 of 656 |
| Connections: Connect button | | 15 | |
| Settings › Juno: API key and Daily cap fields, Save | | 15 | |
| Every row's label or first line | 15 | | |

See `compare/51b-add-a-server-*`, `compare/51c-add-a-server-focus-*` and `compare/46-settings-juno-*`. The Threads popover also uses this preset; its rows have no trailing controls, so it looks the same (`compare/14-threads-popover-*`).

## The narrow toolbar near the top of the list

A narrow row's toolbar rises above the row (round 2), but a row near the list's top put it under the header band's fade, where it showed washed out (`compare/16e-topic-720-hover-first-*` and `16c-*`, top).

Lifting the toolbar above the band is not possible: the band is a layer over the scroller, and nothing inside a scrolled, paint-contained row can stack above it. So the row now decides where its toolbar goes when it is pointed at or focused. `placeToolbar` in `Message.tsx` reads the row's top, the list's top and the band (the scroller's `scroll-padding-top`) once. If a raised toolbar would land under the band, it sets `--row-toolbar-top` on the row, and the toolbar drops inside, just under the name and time line, so they stay readable. On a continuation row, which has no name line, it goes at the top. Otherwise the property is removed and the toolbar rises as before. Nothing re-renders, and nothing runs per frame or on scroll. Rows keep their containment.

One case it does not follow: the pointer held still while the list scrolls a tall row up to the band. The row keeps the placement it had when the pointer entered until the pointer leaves it or moves onto another row.

The gallery's `MessageList` › Narrow group (336px, the topic in a 720px window) shows a mid-list row with the toolbar raised, the first row with it inside, and the first row focused from the keyboard (`gallery/`).

## Verification

- `pnpm gallery:shots` for MessageList and Message, including the new Narrow states.
- `pnpm affected`: typecheck, lint, `test:gallery` (the layout-shift guard over every gallery state, the new narrow ones included) and `test:desktop` passed.
- `pnpm test:feel` on the Mac: 8 of 8 passed, including the two that failed in round 1 (the reaction at the bottom and the tab restore, fixed meanwhile on main). Load 6 to 10. Four warnings, the same ones as in round 1: one small shift as Juno's first bubble arrives (0.0027), the sidebar row moving to the top on a live reply (expected), a 0.0001 shift in a sidebar preview, and one 80ms frame while scrolling the long thread with no page work over 100ms.
- The harness's "topic scrolled" step is skipped now: with round 2's tighter message spacing the thread fits a 1400 × 900 window, and the driver's `scrollUp` waits for a scroll end that never comes. The step is kept and says so.
- Missing feel scenario: hovering a message in a narrow topic, near the list's top and in the middle. Check that the toolbar is whole in its first frame, in the right place, and that nothing moves.
