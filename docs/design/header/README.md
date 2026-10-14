# Topic header

The owner: "The topic page header (or even the Juno chat header) doesn't look modern." He shared three apps as ideas: a light one with no bar and a floating pill of icons, a dark one with a large icon and a breadcrumb under the title, and a light one with a plain title and small bordered buttons. None of them has tabs; Juno does, so each direction here has to sit under the tab strip without the two stacking into a tall block.

Today the header is two rows under a 44px tab strip: the context pill and the actions, then a 32px icon slot and the title at 20px, with a rule below. That is 144px of chrome before the first message.

`mock.html` draws three directions and the recommended one across the topic, the Juno panel and the Juno tab. `node ../../../scripts/heavy.mjs node render.mjs` writes:

| File | Shows |
| --- | --- |
| `a-light.png`, `a-dark.png` | A · One line: thread, Main, DM, narrow |
| `b-light.png`, `b-dark.png` | B · Floating: the same four |
| `c-light.png`, `c-dark.png` | C · Identity: the same four |
| `family-light.png`, `family-dark.png` | A with the Juno panel (Tab order marked), the Juno tab, and the header at scroll top and scrolled |

SPEC section 7 is not changed yet. The owner picks a direction first; the changes A needs are listed at the end.

## What every direction keeps

- The context pill, tinted by kind, is visible at every width. It is the guard against posting in the wrong place.
- The actions: Pin, Notify me, Resolve or Reopen, Juno, More. Main has Threads, Notify me, Juno, More.
- Double-click the title to rename.
- No rule under the header. Messages fade out under it instead.
- No avatar stack of members, though two of the references have one. SPEC 7 leaves people counts out on purpose.

## A · One line (recommended)

One 52px row: the pill, then the title at 15/600, then the actions. The row is opaque `--background`, the same fill as the active tab, so the tab and the header read as one surface. A 20px fade below it is the only edge.

- Chrome: 44 + 52 = 96px, down from 144.
- The pill comes before the title, so the line reads like a path: "# eng  Postgres 16 cutover window". Main reads "# design-review  Main", which keeps SPEC's "#eng · Main".
- The pill drops its "· Public channel" text. The tint and icon already say the kind, and the kind stays in the tooltip and the accessible name. This saves about 110px, which is what lets the whole header fit on one line.
- The title moves from 20px to 15px. At 20px a one-line header looks like a page title over a chat; at 15px it matches the tab label and the sidebar row title, and it still leads the row by weight.
- The art slot goes. The active tab and the sidebar row already show the topic's art; a third copy at 22px next to the pill made the row busy. See the decisions below.
- Tradeoffs: the least novel of the three. It looks like a quiet native toolbar, which is the point, but it does not have the "floating" look of the first reference.

## B · Floating

No bar. Two raised islands (`--surface-raised`, a small layered shadow and a 1px ring) float 10px below the tab strip: the pill and title in the centre with a chevron, and Resolve, Notify me and Juno on the right. The chevron opens the topic menu, which takes Pin, Rename and the rest of More. A 72px fade sits behind the islands.

- Chrome: 44px. The islands sit over the messages, so the reading area starts right under the tabs.
- Closest to the first reference, and the most visibly new.
- Tradeoffs:
  - Floating surfaces with shadows over moving text are the busiest option, the opposite of the calm the spec asks for.
  - A centred title does not line up with the left-aligned reading column, so the eye jumps.
  - The list has to run under the islands, so its scrollbar runs under them too, and the "N new" divider and every scroll position need the island height added.
  - Under 640px the title island moves to the left and the right island keeps only Juno.
  - Rename moves into the menu, because double-clicking text inside a raised button reads as a press.

## C · Identity

A 64px block: the topic art at 36px, the title at 15/600, and under it a 20px context pill followed by the kind in muted text, like a breadcrumb. Actions on the right are 30px bordered buttons, as in the third reference.

- Chrome: 44 + 64 = 108px.
- Gives the topic art the most room, and the context line reads well.
- Tradeoffs:
  - It is still two lines of text, so it saves the least height.
  - Five bordered buttons are heavier than the borderless icons in A.
  - The 20px pill under the title is a weaker guard than a pill on the main line.
  - At 500px (the DM shot) the kind text is cut short against the buttons.

## Recommendation

A. It removes a third of the chrome and the hard rule, it keeps the guard first in the line, and every surface can use it, including the Juno panel, whose header is already 52px. It is also the cheapest to build: one row in place of two, and a static fade.

From B, A borrows only the idea that matters: content runs to the top edge with a fade, not a rule. From C it borrows nothing; C is a good fallback if the owner wants the art in the header.

## A in detail

### Sizes

| Part | Value |
| --- | --- |
| Row | 52px, `--background`, content capped at `--reading-width` (800) and centred, padding `0 20 0 24`, gap 10 |
| Context pill | 24px, `--radius-pill`, padding `0 9`, gap 5, 12.5/600, icon 13, tint by kind. Text is the channel name only |
| Title | 15/600, tracking −0.005em, one line with ellipsis, tooltip when cut |
| Icon buttons | 28×28, radius 8 (`--radius-lg`), icon 16 subtle, gap 2. Pressed: `--secondary-default` |
| Resolve / Reopen | 28px, padding `0 10`, gap 6, 12.5/500, icon 14, inset ring 1px `--border-strong`, 6px space either side |
| Threads (Main) | same as Resolve, "Threads · 12" |
| Fade | 20px under the row, `--background` to transparent, `pointer-events: none` |
| Rename input | 30px, 15/600, the existing style at the new size |

The Juno tab's header becomes the same row: the Juno mark 20, "Juno" 15/600, the banner chip, spacer, More. It was a 44px bar. The Juno panel header keeps its 52px, padding `0 12 0 16`, drops its rule for the same fade, and its name goes from 14 to 15/600. The topic header and the panel header then form one line across the window.

### Narrow

The topic is 336px wide at the minimum window with the sidebar shown. Under 480px of header width, Pin, Notify me and Resolve leave the row. They are already in More, so nothing is lost. Juno and More stay. The pill keeps its tint and icon and gives up its name to an ellipsis only after the title has shrunk to its minimum (about 80px). The pill never disappears.

### Scrolling under the header

- The header stays in flow. The list starts below it, and only the 20px fade overlaps the list's top edge. So the scrollbar starts below the header, and the open position (the "N new" divider at 80px) and the stick-to-bottom logic are unchanged.
- At scroll top (the start of the topic is loaded and in view) the fade is hidden, so the first message is not dimmed. Once scrolled, it fades in over the first 24px of scroll.
- How: a CSS scroll-driven animation. The list declares `scroll-timeline: --topic-list block`, the topic view sets `timeline-scope: --topic-list`, and the fade runs `opacity 0 → 1` on `animation-timeline: --topic-list` with `animation-range: 0 24px`. Its base opacity is 0, so a topic too short to scroll shows no fade. No JavaScript runs on scroll. Electron 44's Chromium supports this.
- If that misbehaves, the fallback is an `IntersectionObserver` on a 1px sentinel at the list's top that sets `data-at-top` on the topic view. It still runs no scroll handler.

### Performance

Checked against `docs/performance.md`. Not measured yet; the reasoning:

- **Fade: about free.** It is a static gradient on its own layer above a composited scroller. Scrolling moves the scroller's layer on the compositor, and the fade is never re-rastered. The cost per frame is one blended 20px strip. Its only animation is opacity driven by the scroll timeline, which runs on the compositor (performance.md 3.3: only `transform` and `opacity` are animated).
- **No anchoring risk.** Nothing changes `position`, `transform`, `overflow` or `display` on the scroller or its ancestors, so scroll anchoring for prepends (5.2) is untouched.
- **Blur: not used.** performance.md 3.3 forbids `backdrop-filter` over anything that scrolls. A blur under the header re-samples and blurs the strip behind it on every scroll frame. That is roughly 936×52 CSS px, or about 195k device pixels at 2x, through two blur passes at a 20px radius. It also forces the content behind into its own render surface. That is a real GPU cost on every frame of the 3s scroll test, and the look it adds (smeared text under the bar) is noisier than a fade. If the owner wants blur anyway, it needs a run of the scroll scenario on the reference Air with the frame budget checked, before it ships.
- **B costs more.** A tall fade under shadowed islands is still a static layer. But the list would have to run under the header, which moves the scrollbar and every pinned scroll offset. That is layout risk in the code that holds the open position.
- The narrow rule stays a CSS container query on the header, as today, so no script measures the width.

### Accessibility

- `<header>`, with the title marked up as the page heading (`h1`). The title is not a Tab stop; rename by keyboard is More › Rename, as it is today.
- Tab order inside the header: context pill → Pin → Notify me → Resolve → Juno → More (Main: pill → Threads → Notify me → Juno → More). The order around it is unchanged: tab strip → header → messages → composer → Juno panel.
- **The context pill's job.** It stays first in the visual line and first in the Tab order, so the channel is the first thing seen and the first thing reached. It loses the visible kind text, but not the information. The kind is in the colour, the icon (hash, lock, person, people), the tooltip and the accessible name: "eng, public channel. Show in sidebar." For private channels and DMs the tint still differs from the public grey, the case that matters most. At the narrowest width the pill keeps its icon and tint. Before posting, the composer's placeholder ("Message #design-review") repeats where the message goes.
- Icon buttons keep their names ("Pin", "Notify me: When it matters", "Juno ⌘J", "More"). Juno is `aria-pressed`; Notify me and More are menu buttons.
- The fade is decorative: `aria-hidden`, no pointer events, and it never covers a control.
- Contrast: the title is `--foreground-default` on `--background`, as before. Text under the fade is not meant to be read, and it is never the newest message or the divider.

## Decisions for the owner

1. **Direction.** A (recommended), B or C.
2. **Art in the header.** A drops the 32px art slot; art stays in the tab and the sidebar row. If the owner wants it in the header, A takes a 22px art before the pill, or the choice moves to C.
3. **Pill text.** A drops "· Public channel" from the visible pill. The kind stays in the tint, the icon, the tooltip and the accessible name.

## Changes A needs (not made yet)

SPEC:

- Section 7 Header. "A context pill shows the channel and its type" becomes: it shows the channel name, with the type in its tint, icon and tooltip. Add that the header is one line (pill, title, actions), that it has no rule, and that messages fade out under it. Add that on a narrow window Pin, Notify me and Resolve move into More.
- Section 7 Main thread. "It reads '#eng · Main' in the header" becomes the pill "#eng" followed by the title "Main". Drop "Messages posted outside threads" from the header.
- Section 7 Juno panel. The panel's header is the same line as the topic's, with no rule.
- Section 13.1 or 13.10. The Juno tab's header is the same line: mark, name, banner chip, More.
- Section 16. Add a line under Surfaces: page headers have no rule; content fades out under them.

inventory.md:

- Section 5 Topic header. Rewrite the container (one row, 52px, padding `0 20 0 24`, gap 10, no border), the context pill (24px, name only, the kind in title and name, and the narrow rule), the buttons (28px; Resolve and Threads 28px, 12.5/500), the title (15/600 in row 1, no 32px art slot), the rename input (30px, 15/600) and the Main header. Add the fade and its scroll-top behaviour.
- Juno tab header (the "Header (Juno tab)" item): 52px row, "Juno" 15/600, the mark at 20.
- Juno panel header (the "Header" item in the panel section): no border-bottom, the fade, "Juno" 15/600.
- The tab order row: inside the header, pill → actions; the title is not a stop.

tokens:

- `--topic-header-height` 100px → 52px.
- New: `--header-fade` 20px and `--header-fade-range` 24px.
- The title text style `--text-topic-title-*` goes from 20/600/−0.01em to 15/600/−0.005em. It is used by the header title and its rename input only.

primitives.md:

- `ContextPill` gains a 24px size, and its `showKind` becomes tooltip-only.
- A `HeaderFade` piece (or a style on the header) that every page header uses.

Code (after the owner picks, and after fix B lands in `TopicHeader.tsx`): `TopicHeader` collapses to one row; `MessageList` declares the scroll timeline; the Juno tab and panel headers use the same row.
