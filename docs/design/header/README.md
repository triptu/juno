# Topic header

The owner: "The topic page header (or even the Juno chat header) doesn't look modern." He shared three apps as ideas: a light one with no bar and a floating pill of icons, a dark one with a large icon and a breadcrumb under the title, and a light one with a plain title and small bordered buttons. None of them has tabs; Juno does, so the header has to sit under the tab strip without the two stacking into a tall block.

Before this pass the header was two rows under the 44px tab strip: the context pill and five actions, then a 32px icon slot and the title at 20px, with a rule below. That is 144px of chrome before the first message.

**Chosen: B · Floating** (decision log 10-14). The owner also chose no topic art in the header, and a pill that shows the channel name only, with the kind in its tint, icon, tooltip and accessible name.

SPEC §7 "Header", §13.1 and §16, inventory §5, §12 and §12.1, `tokens.md`, `primitives.md` and `performance.md` are updated to B. This README explains the choices behind those changes.

## Files

`mock.html` draws every direction. `node ../../../scripts/heavy.mjs node render.mjs [--only key,...]` writes:

| File | Shows |
| --- | --- |
| `b-light.png`, `b-dark.png` | B: a thread with the sidebar, Main, a DM, a 336px topic |
| `b-family-light.png`, `b-family-dark.png` | B on the topic with the Juno panel (Tab order marked), the Juno tab with a banner chip, the panel beside a 520px topic, and the panel covering a 336px topic |
| `b-detail-light.png`, `b-detail-dark.png` | Centred against column-aligned islands, the topic menu open, scroll top with the inset measured, scrolled, narrow thread and narrow Main |
| `a-*.png`, `c-*.png`, `a-family-*.png` | The directions considered (below) |

## B as built

No bar and no rule. Two solid islands float 8px under the tab strip, on a band of the page colour. The message list fills the topic area and scrolls under both.

- **Left island:** the context pill, then the title with a chevron. The title is a menu button that opens the topic's menu, the same menu as its sidebar row.
- **Right island:** Resolve or Reopen (Threads on Main), and Juno.
- **Everything else** (Pin, Notify me, Rename, Copy Slack link, Open in Slack, Mark as unread, Ignore) is in the topic menu. There is no More button; the title is More.

### Calm over text

The first B draft looked busy because shadowed islands sat directly on moving text. Now:

- **Solid islands.** `--surface-default`, 1px transparent border, `--card-ring`, pill radius. There is no blur (performance.md 3.3), and no coloured border (tokens §5).
- **A band behind them.** It is `--background`, solid from the top to 44px (the islands' bottom edge), then fades to transparent by 68px. Text never shows through or beside an island; it fades out in the 24px below them. The islands read as controls resting on the page, not as stickers on the text.
- **The same in both themes.** In light the islands lift only by the soft shadow; in dark, `--surface-default` sits one step above the page, and `--card-ring` adds its darker shadow. Popovers use `--surface-raised` in dark; the islands do not, because they are always on screen and should stay quiet.

### Alignment: on the reading column

`b-detail-*.png` shows both options.

- **Centred** puts the title off the column's left edge, so the eye jumps from the title to the messages. It also needs a second layout for narrow windows.
- **On the column (chosen):** the islands row is capped at 800px and centred, with the column's 24px padding. The left island starts where the composer starts, and the right island ends where it ends. The title reads first, as it does everywhere else in Juno, and one layout works from 336px to any width.

### The list under the header

Everything is CSS. No script runs on scroll.

| What | How |
| --- | --- |
| The scroller | Fills the topic area from the tab strip down; the band and islands are absolute and out of flow |
| Top inset | `padding-top: --header-inset` (56) before the column's 16, so at scroll top the first message starts at 72, below the band's end at 68 |
| Scrollbar | Starts below the band: `::-webkit-scrollbar-track { margin-top: --header-band }` on this scroller only. The thumb never goes under an island, and its whole track stays usable |
| Focus and find | `scroll-padding-top: --header-band`, so keyboard moves, `scrollIntoView` and find-in-page stop below the islands |
| "N new" on open | The divider lands 80px below the band: offset `--header-band` + 80 (148) from the scroller's top. It is the same pin as before, with a larger offset (`dividerTop()` in the `TopicView` container reads the band from the scroller's `scroll-padding-top`) |
| Saved positions | Unchanged. Pins are a row and an offset inside the scroller, and the scroller's size never changes with the header |
| Header changes | Rename, the menu, Juno pressed and the narrow switch happen in an absolute layer, so they cannot shift the list. Today a header change can |

`ScrollArea` gains `underHeader` for this (primitives §10a). The Juno tab's list and the panel's list use it too.

Against `docs/performance.md`:

- **Band and islands.** Each is a static layer over a composited scroller. Scrolling moves only the scroller's layer, and the band and islands are never re-rastered. They have no animation and no blur. The cost per frame is blending one 68px strip and two small rounded rects.
- **Scroll anchoring (5.2).** Nothing changes `position`, `transform`, `overflow` or `display` on the scroller or its ancestors. The padding is static, so prepends anchor as before. At scroll offset 0 the existing pin does the work, as today.
- **Bottom stick (5.2).** Untouched: the bottom of the scroller does not move.
- **Track margin.** It is a style on the pseudo-element. It costs nothing per frame.

Against the feel suite (`pnpm test:feel`), the topic and long scenarios must still pass `opensAtAnchor`, `noLayoutShift` and `landsAndStays`:

- The open frame is decided in the same layout effect, with only the offset changed. `e2e/topic.spec.ts` (`dividerOffset()` is 80) and the `long.feel.ts` scenario title change to 148 in the same change, if they measure from the scroller's top.
- B removes one source of shift: the header no longer takes part in layout, so a rename or a narrow-width switch cannot move the messages.
- The Threads popover check (`interaction.feel.ts`) still applies: the popover opens under the Threads button, now in the right island.

### What stays visible, what goes in the menu

The rule from the 10-14 simplification: keep the interface dead simple, and put per-item choices in that item's menu.

| Action | Where | Why |
| --- | --- | --- |
| Context pill | Left island, always | The wrong-channel guard |
| Resolve / Reopen | Right island | The one action you take on a topic as you finish reading it |
| Threads (Main) | Right island, in Resolve's place | The only way into Main's threads from Main |
| Juno | Right island | Opens the panel; ⌘J does the same |
| Pin, Notify me, Rename, Mark as unread, Copy Slack link, Open in Slack, Ignore | Topic menu, under the title | Per-item choices. They are the row's menu, so they are learned once |
| More | Gone | The title is the menu |

The title opens the menu on click, and on Enter, Space or ↓. The context-menu key and right-click open it too. **Rename** is a menu item that turns the title into a field in place. Double-click rename goes from the header, because a menu button opens on the first click. The row still renames from its own menu.

### Narrow

- **336px topic** (720px window, sidebar shown). The islands keep their places. Resolve becomes a 28px icon button that keeps its name, and Threads shows its icon and count ("12"). The pill shows its full name up to 160px, then takes an ellipsis; the title takes the rest and shortens first. The pill's tint and icon always show, and Juno stays.
- **Juno panel open.** The panel takes 360px. If 480px or more is left, the topic keeps its islands beside the panel, and the two sets share one line (the 520px case in `b-family-*.png`). Under 480px the panel covers the topic, as SPEC §7 already says. The topic's islands are hidden with it, and the panel's islands take the line. A 336px topic with the panel beside it never happens.

### The Juno tab and the panel

- **Juno tab.** The same band and islands, with the row capped at the chat's 720px column. Left: the Juno mark, "Juno" and the chevron, which opens the Juno menu (Scheduled, What Juno remembers, Memory of this chat, Activity, Connections, Settings › Juno) and replaces the More button. Right: the banner chip ("Juno is paused · Resume"), only when there is one.
- **Juno panel.** The same islands, on the same line as the topic's. Left: the Juno title button with the same menu. Right: Open in a tab and Close. The panel's rule under its header goes.

### Accessibility

- **The context pill's job.** It is first in the left island, first in the Tab order and never hidden. The kind is no longer written on it. It is in the tint (amber for private, blue for DMs, neutral for public), the icon (hash, lock, person, people), the tooltip and the accessible name: "eng, public channel. Show in sidebar." The composer placeholder ("Message #design-review") repeats where a message goes.
- **Tab order** in the topic header: pill → title (menu button) → Resolve or Threads → Juno. Then the list and the composer, then the panel's islands if the panel is open.
- **Names.** The title button sits inside the page's `h1`. It has `aria-haspopup="menu"` and `aria-expanded`, and its name is the title. Juno is `aria-pressed`. In narrow windows the icon-only Resolve keeps the name "Resolve" ("Reopen"), and Threads is named "Threads, 12".
- **The band** is `aria-hidden` and has no pointer events. It never covers a control, the newest message or the divider.
- **Focus rings** draw outside the islands' buttons, inside the island's padding, so they are not clipped.

## Considered

### A · One line

A single 52px opaque row with the pill, the title at 15/600, and the actions, and a 20px fade below it. It saves 48px of chrome and is the cheapest to build. It was the design pass's recommendation. The owner chose B for its lighter look: no bar at all, and fewer visible buttons. A's sizes and its scroll-driven fade are in this folder's history (`git log -- docs/design/header`).

### C · Identity

A 64px block led by the topic art at 36px, the title with the pill under it like a breadcrumb, and 30px bordered buttons. It gives the art the most room but saves the least height, and the bordered buttons are heavy. The art choice ruled it out.

## Left for the owner

- **Double-click rename in the header.** B drops it, because the title is a menu button; Rename is the first editing item in the menu. Keeping double-click would mean the title opens the menu on a delayed single click, which feels slow. Recommended: drop it, as specced.

## For the build (after fix B)

- `TopicHeader` becomes the two islands over the topic area. It renders `HeaderBand`, `Surface kind="island"` twice, `ContextPill size={24}` without `showKind`, the title menu button, and the right island.
- `TopicView` puts the list's `ScrollArea underHeader` under the header and changes `DIVIDER_TOP` to `--header-band` + 80. `e2e/topic.spec.ts` and `long.feel.ts` change with it.
- The Juno tab and `JunoPanel` headers use the same pieces.
- Tokens: add `--header-island-top`, `--header-island-height`, `--header-band`, `--header-band-solid` and `--header-inset`; remove `--topic-header-height`.
- The topic menu is the existing native row menu (inventory §15.1), opened from the title button's position.
