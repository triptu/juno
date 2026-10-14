# M4 design review: topic view, tabs, messages, Threads, stealth, topic art

October 2026. Reviewed against `docs/design/handoff/SPEC.md` (sections 5, 6, 7, 16, 17), `docs/design/inventory.md` (sections 3 to 6), `docs/design/friendly-layer.md`, `tokens.md` and `primitives.md`, with the `better-interface` review (accessibility, layout, writing, typography, colour, UI polish) run over rendered screens, not only source. Code was read at `2bd9e40`.

## Scope and how it was checked

- **Gallery.** `pnpm gallery:shots` (the full run times out after ten minutes, past `IconButton`; the view states were shot with a throwaway script instead) plus accent and zoom shots. Cited frames are in `shots/gallery/` and `shots/gallery-extra/`.
- **The app** against the fake Slack through the e2e driver: the default seed, a seed with long names, right-to-left text, emoji, hostile text, forty reactions, a long channel name and thirty extra followed threads, and the 300-message seed. Light and dark, Coral, Teal, Midnight blue and Marigold, the minimum 720 by 480 window, a 2400-wide window, offline, and the keyboard. Shots are in `shots/app/`; the keyboard and layout-shift notes are in `shots/app/log.md`; the measured contrast of every text pair on the main screen is in `shots/app/contrast-*.json`.
- **Not reviewed.** 200% zoom in the app (the window screenshot captured only a quarter of the zoomed page; the gallery zoom shots in `shots/gallery-extra/zoom200-*` stand in and show no clipping). Slow images in the app (the fake serves bytes at once; the gallery's pending and failed thumbnails were checked instead). The hover toolbar in the app (not mounted until M6; reviewed in the gallery).

What held up: no text pair on the main screen falls under 4.5:1 in light (lowest 4.85), dark (lowest 5.8) or Marigold (lowest 4.85). Row hover, tab switch, theme switch, Mark read and a live message at the bottom move nothing (`log.md`). Thumbnails reserve their box, a failed image keeps it, long words wrap, forty reactions wrap, `<script>` and bidi overrides stay inert, Arabic titles and messages align right with a correct ellipsis in the row and header, and the 300-message thread opens at the bottom with "2 new messages" and "Jump to latest" working as the inventory says. The empty, loading, offline and caught-up states read well and match the friendly-layer copy.

## Findings

### Blockers

**B1. The topic header overflows at the minimum window width.** At 720 by 480 the workspace is 336px wide. The context pill cannot shrink, so the Threads button is cut to "Threa" and the bell draws on top of it; in stealth the stealth chip, Mark read and the bell overlap and the text runs past the edge. The Threads popover then opens half outside the pane. SPEC 4 names 720 as the minimum and 16 says the context pill is "always visible"; a control overlapped at a supported width is a layout blocker.
Evidence: `shots/app/50-minimum-window-main-light.jpg`, `shots/app/52-minimum-window-stealth-light.jpg`, `shots/app/51-minimum-window-threads-light.jpg`. Source: `packages/ui/src/ContextPill.tsx:49` (`flexShrink: 0` on the pill), `packages/ui/src/Chip.tsx:161` (same on every chip, so the stealth chip cannot give way either), `packages/views/src/TopicHeader.tsx:205` (the row has `minWidth: 0` but nothing in it may shrink).
Fix: give `ContextPill` `flexShrink: 1` with `minWidth: 0` (its name already has `textOverflow: ellipsis`), and let the dashed stealth `Chip` shrink the same way through a `shrink` prop or by the header wrapping it in a `minWidth: 0` span with `overflow: hidden`. Keep `flexShrink: 0` on the actions. Below a width where the pill and the actions still do not fit, drop `showKind` (the "· Public channel" suffix) first. Add a `TopicHeader` fixture at 336px wide with the Main and stealth variants, so the shift guard covers it.

**B2. Thirty tabs: the active tab, most tabs and the New tab button are clipped with no cue and no way to reach them.** With 37 tabs each shrinks to the 72px minimum, which fits only the icon and the close button, so every tab loses its label, and the strip hides tabs 11 to 37 under `overflow: hidden`. The active tab sat at x 3130 in a 1200px strip, so the user could not see which tab was open, and the "+" button was off screen. The keyboard reaches hidden tabs but the focus ring is invisible, and each tab costs two Tab stops (the tab and its close button), so passing the strip takes 74 presses. Inventory 4 only says tabs shrink to 72; SPEC 6 says tabs "work like browser tabs", and browser tabs never hide the active one.
Evidence: `shots/app/73-thirty-tabs-light.jpg`, `shots/app/74-thirty-tabs-keyboard-light.jpg`, `shots/app/76-thirty-tabs-minimum-window-light.jpg`, `log.md` ("thirty tabs" and "after 40 Tabs"). Source: `packages/ui/src/Tabs.tsx:101` (strip `overflow: hidden`), `:123` (`--tab-min-width` 72), `:59` (`tabIndex={0}` on every tab), `:74` (close button in the tab order).
Fix, in two parts. Layout: keep the active tab visible by scrolling the strip (a horizontal `ScrollArea` with `scrollbar="hover"`, `scroll-snap-type: x proximity`, and `scrollIntoView({ inline: 'nearest' })` on the active tab when it changes) and keep the "+" button out of the scroller in the `trailing` slot, so it never leaves the screen. Raise the floor to a width that keeps six or so characters of label (about 120px, a new `--tab-min-width`), and hide the close button on inactive tabs below that width (show it on hover and focus, as Safari does), so a narrow tab still shows its icon and label. Keyboard: the strip is a `tablist`, so use the APG tabs pattern with roving tabindex (only the active tab in the Tab order, Left and Right arrows to move, Delete or ⌘W to close), which also fixes the two-stops-per-tab cost. This touches `Tabs.tsx` and `Workspace.tsx` only.

**B3. A truncated topic title has no way to the full text, and its tooltip says something else.** The header title is one line with an ellipsis and `title="Double-click to rename"`, so hovering the long title shows the rename hint instead of the title. A Main header has no tooltip at all. The same truncation without a tooltip is on the thread link under a Main message, on the rows of the Threads popover, and on a long sender name in a message header. The sidebar row already solves this (`titleWhenTruncated` sets the title only when the text is cut).
Evidence: `shots/app/62-topic-long-title-light.jpg`, `shots/app/71-main-long-thread-link-light.jpg`, `shots/app/72-threads-long-title-light.jpg`, `log.md` (`truncated` entries with `tooltip: false` for `checkout.spec failed again on main. Third…`). Source: `packages/views/src/TopicHeader.tsx:153` (the rename hint as the title), `packages/views/src/ThreadLink.tsx:33`, `packages/views/src/ActiveThreads.tsx:66`, `packages/views/src/Message.tsx` (the `messageName` text).
Fix: move `titleWhenTruncated` from `TopicRow` into `Text` as a `tooltipWhenTruncated` prop (one width read on pointer enter, nothing on render), and use it on the header title, the thread link title, the Threads rows and the message name. Keep the rename hint out of `title`; the double-click affordance belongs to the context menu's Rename item in M5, or to a visible pencil on hover.

### Should fix

**S1. Focus is lost after Escape in the Threads popover, after Mark read, and after closing a tab from the keyboard.** In all three the focused element unmounts and focus falls to `body`, so the next Tab starts from the top of the document. The accessibility rule is to return focus to the trigger or its neighbour.
Evidence: `log.md` ("threads popover: focus after Escape = body", "after Mark read: body", "after closing a tab with Enter on its X: body"). Source: `packages/ui/src/Popover.tsx:57` (Escape calls `onClose` and nothing restores focus), `apps/desktop/src/renderer/containers/TopicView.tsx:75` (Mark read removes the button under the focus), `apps/desktop/src/renderer/containers/navigation.ts:153` (close tab).
Fix: `Popover` remembers `document.activeElement` on open and, when it closes while focus is inside the panel, focuses the anchor's first focusable element. `TopicHeader` moves focus to the bell (the next action) after Mark read. `Workspace` focuses the tab that takes the closed tab's place, or the "+" button when none is left.

**S2. The toggle buttons change their name instead of their state.** The bell is `aria-pressed` and also renames itself "Subscribed. Click to unsubscribe." / "Unsubscribed. Click to subscribe.", so a screen reader hears both the state and a sentence about clicking, and the tooltip ("Unsubscribe") says a third thing. Better-writing: an icon button's name is the action; better-accessibility: a pressed toggle keeps one name.
Evidence: `log.md` ("button 'Subscribed. Click to unsubscribe.'"). Source: `packages/views/src/TopicHeader.tsx:119`, `packages/views/src/ActiveThreads.tsx:55`. Inventory 5 specified the long names; this corrects the inventory.
Fix: `label="Subscribe"`, `pressed={subscribed}`, and let the tooltip repeat the label. Update inventory 5.

**S3. The Threads popover rows are focusable list items that act like buttons.** `ListRow` sets `role="button"` when it has `onSelect`, but `ActiveThreads` passes `role="listitem"` in `rest`, which overrides it. The rows take focus and open on Enter, but announce as list items with no actionable role, and the row's accessible name is the concatenation of title, chips, meta and the bell's name.
Evidence: `log.md` ("focus after Tab = div[listitem] 'Draft plan is in the doc6 replies · 4m'"). Source: `packages/views/src/ActiveThreads.tsx:46`, `packages/ui/src/ListRow.tsx:51` and `:55` (the override).
Fix: wrap each `ListRow` in an `li` (or a span with `role="listitem"`) and leave the row as the `role="button"` named by its title through `aria-labelledby`, with the reply count and time as `aria-describedby`, the same shape as `TopicRow`. `ListRow` should put `{...rest}` before its own `role` so an owner cannot undo the semantics by accident.

**S4. Every `#channel` chip in every message is a tab stop.** The chip is a real `button` without the roving `tabIndex`, so with the message list open Tab walks through each channel mention in all 300 rows before reaching the composer slot. The thread link already follows the row's `tabbable` flag.
Source: `packages/views/src/MessageBody.tsx:171`. Fix: pass the row's `tabbable` down to `MessageBody` and set `tabIndex={tabbable ? 0 : -1}` on the chip (and on links, which are also focusable), or make the chip `tabIndex={-1}` and reachable from the focused row with Enter, as ThreadLink is.

**S5. The hover toolbar covers the message text.** The toolbar sits inside the row at top right, over "the header line's empty end"; when the first body line is long it lies on the text ("WAL posi…" in the shot). It is not mounted until M6, so fix it before then.
Evidence: `shots/gallery/MessageList--interaction--hover-toolbar-light.jpg`. Source: `packages/views/src/Message.tsx:224`.
Fix: keep the toolbar in the row's box (paint containment) but give the header line a reserved end: `paddingInlineEnd` on `styles.header` equal to the toolbar's width (five 28px buttons plus gaps, about 190px, a `--toolbar-reserve` token) on rows that have a toolbar, so the name and time never run under it, and shift the toolbar down to sit on the header line (`top: --space-0-5` already) with the body text starting below it. If the owner prefers the prototype's floating toolbar at top −14, that needs `contain: content` removed from rows and a check against performance 3.3.

**S6. The hovered message is almost invisible.** The hover fill is `--background-subtle`, which is 1.02:1 against the page in light and 1.05:1 in dark, so the only cues on hover are the gutter time and, from M6, the toolbar. Rows, menu items and the Threads list use `--surface-hover`.
Evidence: `shots/app/04-thread-hover-continuation-light.jpg`, `shots/app/25-thread-hover-dark.jpg`. Source: `packages/views/src/Message.tsx:152`.
Fix: use `colors['--surface-hover']` (same token as every other hovered row) and keep the mention tint on mention rows. Inventory 6.1 says `--background-subtle`; that was the prototype's value and should change with it.

**S7. On a wide window the header does not line up with the column it heads.** The message column and the composer are capped at 800px and centred; the header stays full width, so at 2400px the pill and title sit 600px left of the first message and the bell 600px right of it.
Evidence: `shots/app/53-wide-window-thread-light.jpg`. Source: `packages/views/src/TopicHeader.tsx:187`.
Fix: keep the header's background and bottom rule full width and cap its content with the same `--reading-width` and the column's inline padding, centred with `marginInline: auto`, so pill, title, actions, messages and composer share one left edge.

**S8. A long code block is a scroll trap inside the list.** Code blocks cap at 150px and scroll inside with `overscroll-behavior: contain`, so with the pointer over an 80-line block the wheel never reaches the list, at either end of the block. Contained overscroll is for overlays; inline content should hand the wheel back at its edges.
Evidence: `shots/app/66-topic-hostile-bottom-light.jpg`. Source: `packages/ui/src/CodeBlock.tsx:27`.
Fix: drop `overscrollBehavior: 'contain'` from the message code block (keep it for the prompt block in a card if that is wanted), or render message code in full with no inner scroller and let a long block be long: a reader scrolls past it like any other message.

**S9. Tab labels have no direction.** The tab label has no `dir="auto"`, so an Arabic title shows its end instead of its start ("…نا مراجعة خطة الترحيل غدًا"), the opposite of the row and header, which get it right.
Evidence: `shots/app/64-topic-rtl-light.jpg` (second tab). Source: `packages/ui/src/Tabs.tsx:68`. Fix: `dir="auto"` on the label span.

**S10. The reaction chips announce only a number.** The emoji is `aria-hidden` and the meaning ("2 👍, including you") is in `title`, which assistive technology does not read reliably, so a list item reads as "2".
Source: `packages/views/src/Reactions.tsx:28` and `:39`. Fix: put `aria-label={label}` on the `role="listitem"` span (the interactive chip already does this on its button).

**S11. The sidebar row is a button with a button inside.** `TopicRow` is `role="button"` and holds the Resolve `IconButton`. A button's children are presentational, so screen readers flatten the Resolve button away. Inventory 3 specified this shape, so it is a correction to the inventory as well.
Source: `packages/views/src/TopicRow.tsx:110` and `:215`. Fix: the row becomes `role="listitem"` inside `role="list"` with `tabIndex`, `aria-labelledby` and the existing Enter and Space handling; the Resolve button stays a real button. The e2e driver's `getByRole('button', { name: title })` changes to `getByRole('listitem', …)`; the same shape as S3.

### Nits

**N1. The topic art in a tab is clipped by one pixel.** The tab's icon slot is 15px (`--icon-15`) with `overflow: hidden`, and the container draws `TopicArt` at 16px in it. Source: `packages/ui/src/Tabs.tsx:157` to `:159`, `apps/desktop/src/renderer/containers/Workspace.tsx:28`. Fix: a 15 size in `TopicArt`, or a 16px slot (then move the label by 1px with the gap, not by padding).

**N2. The header height token lies.** `--topic-header-height` is 95px (inventory 5, with 26px rows) but the built header is two 32px rows plus the 8px gap plus 28px of padding, 100px. Source: `packages/tokens/src/tokens.stylex.ts:615`, `packages/views/src/TopicHeader.tsx:210`. Fix: set the token to 100 and the inventory with it, or keep the rows at 26 by making the 32px buttons the only tall thing (they already are; the row's `minHeight` can go).

**N3. Close buttons are under the 24px minimum target.** The tab close button is 20px and the row Resolve 22px (WCAG 2.5.8 AA asks for 24px or clear spacing). Source: `packages/ui/src/Tabs.tsx:74`, `packages/views/src/TopicRow.tsx:215`. Fix: keep the glyph and extend the hit area with a `::before` pseudo-element to 24px, in `IconButton` for the 20 and 22 sizes.

**N4. Blank lines in a message are kept.** `white-space: pre-wrap` keeps five empty lines, so a message of whitespace is a tall empty row. Evidence: `shots/app/66-topic-hostile-bottom-light.jpg` (the gap above "many blank lines above"). Source: `packages/views/src/MessageBody.tsx:254`. Fix: trim leading and trailing breaks in `@juno/richtext`, and collapse runs of more than two.

**N5. Emoji-only messages are not larger in the app.** The gallery draws one to three emoji at 1.75× (`shots/gallery/TopicView--content--emoji-only-light.jpg`); in the app the same messages render at text size (`shots/app/65-topic-emoji-light.jpg`) because the fake sends emoji as text, not as `emoji` elements. Not a view bug, but worth one check against a real workspace message before M6, since Slack also sends `:name:` in `text` for some clients.

**N6. "Press ⌘K" promises a shortcut that does nothing until M9.** `packages/views/src/Workspace.tsx:86`. Keep the friendly-layer copy but hide the second clause until ⌘K ships, or wire ⌘K to the Browse popover meanwhile.

**N7. The `time` elements have no `dateTime`.** `packages/views/src/Message.tsx:91` and `:102`. Add `dateTime={new Date(at).toISOString()}` through a `dateTime` prop on `Text`.

**N8. Home and End in the message list.** `TopicList` handles Home and End; `MessageList` handles only the arrows. `packages/views/src/MessageList.tsx`. Add them.

## Work packages

Disjoint file ownership, so they can run in parallel once the perf work on the topic view and tab containers has merged.

**WP A. Tabs and header layout.** B1, B2, S7, S9, N1, N2.
Files: `packages/ui/src/Tabs.tsx`, `packages/ui/src/Tabs.fixtures.tsx`, `packages/ui/src/ContextPill.tsx`, `packages/ui/src/Chip.tsx` (the shrink prop only), `packages/views/src/TopicHeader.tsx`, `packages/views/src/TopicHeader.fixtures.tsx`, `packages/views/src/Workspace.tsx`, `packages/views/src/Workspace.fixtures.tsx`, `apps/desktop/src/renderer/containers/Workspace.tsx`, `packages/tokens/src/tokens.stylex.ts` (`--tab-min-width`, `--topic-header-height`, a `--toolbar-reserve` is WP C's), `docs/design/tokens.md` and `docs/design/inventory.md` sections 4 and 5. Add a 336px header fixture and a 37-tab fixture; `pnpm test:gallery` must pass the shift guard on both.

**WP B. Focus, names and roles.** S1, S2, S3, S4, S10, S11, N3, N7, N8.
Files: `packages/ui/src/Popover.tsx`, `packages/ui/src/ListRow.tsx`, `packages/ui/src/IconButton.tsx` (hit area), `packages/ui/src/Text.tsx` (`dateTime`), `packages/views/src/ActiveThreads.tsx`, `packages/views/src/TopicRow.tsx`, `packages/views/src/Reactions.tsx`, `packages/views/src/MessageBody.tsx` (the chip's `tabIndex` only), `packages/views/src/MessageList.tsx` (keys only), `apps/desktop/src/renderer/containers/TopicView.tsx` (focus after Mark read), `apps/desktop/src/renderer/containers/navigation.ts` (focus after close), `apps/desktop/e2e/driver/juno.ts` (the row and Threads selectors), `docs/design/inventory.md` sections 3 and 5 (the names). WP B's edits to `TopicHeader.tsx` are the bell's label and the focus move after Mark read; coordinate those two lines with WP A, or land WP A first.

**WP C. Messages: truncation, hover, toolbar and content.** B3, S5, S6, S8, N4, N5.
Files: `packages/ui/src/Text.tsx` (`tooltipWhenTruncated`; WP B adds `dateTime` to the same file, a one-line prop each, so agree on the order), `packages/ui/src/CodeBlock.tsx`, `packages/views/src/Message.tsx`, `packages/views/src/Message.fixtures.tsx`, `packages/views/src/ThreadLink.tsx`, `packages/views/src/HoverToolbar.tsx` if the reserve needs a width export, `packages/richtext/` (blank lines), `docs/design/inventory.md` section 6. `TopicHeader`'s title line (B3) is one prop on the `Text`; WP A owns that file, so WP C sends that one-line change to WP A.

**WP D. Copy and docs.** N6, and the inventory and token corrections the other packages do not touch: inventory 4 (tabs: the scroll and label floor), 5 (header: 100px, pill shrink, toggle names), 6.1 (hover fill) and 6.5 (the toolbar reserve), `tokens.md` 5 (the two tokens). Files: `packages/views/src/Workspace.tsx` (one string; land after WP A) and the docs. Small enough to fold into WP A if a fourth agent is not available.

## Verification to repeat after the fixes

- `pnpm test:gallery` with the new 336px header and 37-tab fixtures.
- In the app: the minimum window with Main, a thread and a stealth tab; 37 tabs with the last one active; Tab from the Threads button, Escape, then Tab again lands in the popover's row, not at the top of the page; Mark read from the keyboard leaves focus on the bell.
- Hover a long message with the toolbar mounted: no text under the toolbar.
