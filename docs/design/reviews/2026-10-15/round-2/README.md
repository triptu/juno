# Design review 2026-10-15, round 2: the owner's decisions

The owner decided all six questions of the first round (`../README.md`) as recommended, and asked for the Unread toggle to become an icon. This round applies them on `design-review-1015-2`. SPEC, inventory, `tokens.md`, `primitives.md` and `performance.md` are updated to match.

`compare/` stacks the shot from main (`2bfe29c0`, top) over the same shot on this branch (bottom), in light and dark. `after/` holds the Unread only hover and pressed shots, which main has no counterpart for. `gallery/` holds the new Sidebar gallery states and the icons tried for Unread only. The harness is `../harness/review.spec.ts` (`REVIEW_SET=round-2/before|after`); its measurements are in `../harness/out-round-2/`.

## What changed

**Q1. One message rhythm.** A message header is the same height in every list: topic, peek and the New chat preview. The topic header's 34px minimum is gone, so the gap from name to body in a topic matches the other two (`compare/02-topic-thread-*`, `compare/13-main-*`). The hover toolbar now covers the end of the first body line, never the name or the time, which keep `--toolbar-reserve` (`compare/07-message-hover-toolbar-*`). In a row under 464px wide (a container query on the row) the header takes the whole line and the toolbar sits wholly above the row's top edge, over the end of the row before (`compare/16c-topic-720-hover-*`). Rows keep `contain: content` and `content-visibility: auto` (performance.md 3.3). The toolbar paints outside the row through `overflow-clip-margin: var(--toolbar-clip-margin)` (44px). It must be a plain length: Chromium 152 computes `overflow-clip-margin` given any `calc()` as 0, which was this round's first bug. A hidden toolbar is `display: none` (main's performance fix, `8f568c17`, merged here), so one raised over the row before never takes that row's pointer.

**Q2. One settings column.** Notifications, Preferences and Settings › Juno use `--page-width-settings` (760px), and all three titles sit at x 539 at 1400 × 900 (Notifications was at 479). The unused `wide` page width and `--page-width-wide` are removed. The hours rows fit at 760 (`compare/24-notifications-*`).

**Q3. Sentence case.** Section labels (Pinned, Recent, Channels, Session, Diagnostics), the All topics column heads, the "2 new" divider, the Juno day separator ("Today") and the Juno group labels render as written. The 0.06em tracking that existed only for the caps is removed, along with its three tokens. See `compare/13-main-*`, `compare/23-account-menu-*`, `compare/17b-sidebar-pinned-recent-*`, `compare/19b-new-chat-picker-search-*`, `compare/41-juno-tab-chat-*`.

**Q4. No attach mark.** The topic and New chat composers have no "+". Their text starts 18px inside the border, as in the Juno composer: the textarea moved from x 555 to 531 in a field at 516. `ComposerSlot` matches, so the swap still moves nothing. `Composer` has a `leading` slot where the Attach button goes when attachments are built (`compare/18-new-chat-*`).

**Q5. Activity.** A run with no actions has no card: it is its head line ("You · 15:17 · Replied"), with its read line under it when it has one (`compare/47-page-activity-*`).

**Q6. Prices.** "Claude Sonnet 5.5 · $2 in, $10 out per million tokens". The string is built in `packages/agent/src/settings/settings.ts`; its test, the e2e check and the view fixtures moved with it (`compare/46-settings-juno-*`).

**Unread only.** The sidebar's Unread text toggle is now an icon pill like Channels and DMs: Phosphor's `notification` (a box with a dot on its corner, the same mark the pills use for unread), with the tooltip and accessible name "Unread only" and the pressed fill while it is on. Measured at 1400 × 900: all four icon pills (Channels, DMs, New view, Unread only) are 28 × 28 at y 171 with a 14px icon inset 7px on every side, so the row stays 28px tall. Unread only's right edge is 373, the sidebar's inset. `gallery/unread-icon-candidates.jpg` shows the icons tried: a filled circle was too heavy beside the outline icons, Phosphor's dot too small, and an envelope reads as mail. The Sidebar gallery gains `Interaction/unread-hover` and `Interaction/unread-focus`; `List/unread-only` shows it pressed.

## One limit to know

When a narrow row sits within about 70px of the list's top, its raised toolbar falls under the header band, which is solid to 44px and fades out by 68px, so the toolbar shows washed out (`compare/16c-topic-720-hover-*` and `16e-*`, bottom). The band is a layer over the scroller, so the toolbar cannot rise above it. Scrolling the row down a little clears it. If this matters, the options are to drop such a row's toolbar back into the row, which needs script to know where the row is, or to keep the header islands narrow enough that the band leaves room. Neither is done here.

## Verification

- `pnpm affected` on the branch after merging main (`6e7f333e`, whose toolbar `display: none` change conflicted with this round's `visibility` and replaced it): typecheck, lint, `pnpm test`, `test:gallery` (the layout-shift guard over every gallery state, Message and Sidebar included) and `test:desktop` all passed.
- `pnpm build` after each change; the compiled CSS has the `@container message (width < 464px)` rules and `overflow-clip-margin: var(--toolbar-clip-margin)`.
- `overflow-clip-margin` was checked on a standalone page in the app's Electron (Chromium 152): a plain length or `var()` paints and hit-tests outside a `content-visibility: auto` row; any `calc()` computes to 0.
- Not run: `pnpm test:feel` and `pnpm perf`. Rows keep their containment, so the list's layout and paint cost should be unchanged, but that is not measured here.
