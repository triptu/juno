# Juno design inventory

Every surface and component in the v1 design, with structure, states, measurements, copy, keyboard behaviour and the screenshot that shows it. Values are from the prototype (`docs/design/handoff/prototype/Threads v3.dc.html`) unless marked **[spec]** (SPEC.md wins over the prototype) or **[proposed]**. Token names refer to `docs/design/tokens.md`.

Screenshot references: `S01`–`S15` are `docs/design/handoff/screenshots/01-ui.png` … `15-ui.png`. References like `shot 07-message-hover-toolbar` are captures I took from the prototype (kept outside the repo in `/tmp/juno-design/shots/`, not needed to build; reproduce by opening the prototype).

Conventions that apply everywhere (SPEC §16):

- No `cursor: pointer`. Arrow cursor on buttons, rows, tabs, menu items. Text cursor only in editable text.
- Hover styles only under `@media (hover: hover)`. Hover-revealed actions also show on `:focus-visible` / `:focus-within`.
- Press: `scale(0.96)`, 150ms ease-out, never when disabled.
- Background-colour feedback at most 150ms.
- Icons: Lucide, stroke = surrounding text colour.
- Chrome is not selectable; message text and inputs are.
- Focus ring: 2px, offset 2px, keyboard only.
- Numbers use tabular figures.
- Sentence case. Buttons start with a verb.
- Context menus are native (spec). The prototype's DOM menus define the item order and labels; native menus cannot show the icons or the right-aligned hints ("⌘ click", "Stays unread"), so those are dropped or moved to the shortcut column.

---

## 1. Window and title bars

**Shows:** S01.

- Two panes: sidebar on the left, 384px by default (`--sidebar-width`), resizable and collapsible (below); workspace fills the rest. Root is `display: flex; height: 100%; overflow: hidden`.
- Root text: 14px, line-height 1.5, letter-spacing 0.01em, `--font-sans`, colour `--foreground-default`, background `--background`.
- Sidebar top bar: 44px, padding `0 10px 0 16px`, background `--background-subtle`. Traffic lights live here (Electron `titleBarStyle: 'hiddenInset'`; the prototype fakes them as 12px circles with 6px gaps). The bar is a drag region (`-webkit-app-region: drag`), buttons inside are `no-drag`.
- Workspace top bar: the tab strip, 44px, also a drag region. Border-bottom 1px `--border-default`, background `--background-subtle`.
- Sidebar top bar, left to right: traffic lights · **Collapse sidebar** (`sidebar-simple` 16) · **Back** (`caret-left` 16) · **Forward** (`caret-right` 16), each 30×30 radius 8, the same style as the title bar icons (§2.1), starting 78px from the window edge so the traffic lights keep their space; then the right-aligned group (§2.1). Back and Forward are disabled (opacity `--opacity-disabled`, no hover) when the active tab has nowhere to go. Names "Back ⌘[", "Forward ⌘]", "Hide sidebar ⌃⌘S". A long press on Back or Forward lists that tab's history as a native menu, as in Safari. [built] The press lasts 500ms; Back and Forward themselves act on click, not on mouse down, so a long press can become the menu. The menu names each entry by its tab title ("New chat" for a New chat, "Topic" when the topic's header is not loaded).
- Sidebar right edge: 1px `--border-default`. **Resize**: a 6px hit area centred on the edge (no visible handle; `col-resize` cursor over it, the one place a non-arrow cursor shows besides text). Drag between `--sidebar-min-width` 280 and `--sidebar-max-width` 480; double-click resets to 384. While dragging, only the sidebar box's inline `width` changes (set from a pointer-move handler, written once per frame); rows are fluid, so nothing re-renders, and the width is saved on pointer up. [built] It is a plain width and not a CSS variable: an inherited custom property changed on the shell made Chromium restyle every element under it, 4.7 ms a frame on the large workspace (performance.md 1). The tab strip and topic column take the rest and re-centre.
- **Collapse**: ⌃⌘S, the collapse button, or View › Hide Sidebar hide the sidebar in one frame (no slide; under reduced motion it would be the same). Collapsed, the tab strip starts with the traffic lights' 78px, then Show sidebar, Back and Forward (the same 30px buttons), then the tabs. The state is saved. Dragging the edge below 200px also collapses it. [built] It collapses when the drag ends there, and the saved width is kept for the next show. The width and the hidden state are saved in `launch.json` with the theme, so the first frame after a launch already has them.
- Scrollbars: 10px, transparent track, thumb `--border-strong` with 3px transparent inset and radius 10 (`::-webkit-scrollbar`). Scroll containers use `overscroll-behavior: contain` so menus, popovers and the palette never scroll the page behind.

## 2. Sidebar

**Shows:** S01 (whole sidebar; its Browse and Theme icons and For you item are removed), S02 (row context menu), shot 30-avatar-menu, shot 33-scope-chip.

**One inset** (`--sidebar-inset`, 10px) on both sides of everything that spans the sidebar: the title bar's end, the nav items, the filter row and the topic rows, measured from the sidebar's content box (inside its right border). The list's 10px scrollbar gutter is part of the right inset, so the 4px thumb sits inside the margin and reserves no extra width; a row is 10px from either edge with a scrollbar or without one. The gallery's `geometry.spec.ts` checks this to the pixel. Before 10-15 the rows sat 8px from the left and 18px from the right.

### 2.1 Title bar icons

Right-aligned group, gap 2px, inside the 44px bar.

| Button | Icon | Size | Accessible name | Action |
| --- | --- | --- | --- | --- |
| Search | `search` 16 | 30×30, radius 8 | "Search ⌘K" | Opens ⌘K palette |
| New chat | `note-pencil` 16 | 30×30 | "New chat ⌘N" | Opens a New chat in a new tab (§8) |
| Me | avatar 24 | 30×30 round, margin-left 4 | "Account and preferences" | Toggles the avatar menu |

Style: transparent, colour `--foreground-subtle`, hover `--surface-hover`, press scale .96.

**Avatar menu** (popover, 248px wide, anchored top 36px right 0, z 20, padding 6, radius 13, `--pop-shadow`):

- Header: avatar 32 with a presence dot (10px, 2px ring in the menu surface: `--success` when active, hollow `--foreground-muted` ring when away) + "Tushar" 13/600 + "Active" or "Away until 9am" 12 muted (`untilLabel` on the active hours; "Active until 8pm" when a change by hand runs to the next switch); padding `8 8 10`.
- Separator 1px `--border-default`, margin `2 6 4`.
- Items 32px, radius 6, padding 0 8, gap 10, icon 15 `--foreground-subtle`, label 13, right hint 11 muted:
  - Set yourself away (`moon`) / Set yourself active (`sun`) — by state; calls `presence.set` and lasts until the next switch in the active hours
  - Set status (`circle-dot`)
  - Notifications (`bell`) — hint "Paused until 9am" outside notification hours, none inside
  - Preferences (`settings`) — hint "⌘,"
  - AI assist (`sparkles`) — [proposed] right side is a switch; prototype shows nothing
  - separator
  - Switch workspace (`arrow-left-right`)
  - Sign out (`log-out`)
- Closes on Esc, outside click, or picking an item.
- [built M10] Header, Set yourself away or active, Notifications (with "Paused until 9am") and Preferences ("⌘,", also Juno › Settings… in the app menu). Set status, AI assist, Switch workspace and Sign out as an item are not built; the Session block (with Sign out) and the diagnostics stay under the items until they are. The line under the name is the workspace until presence is known. The away dot's ring is 1px.

### 2.2 Navigation

Container padding `4 10 0` (`--sidebar-inset`), gap 2. Three full-width buttons, none with a count, 32px, radius 7, padding 0 10, gap 10, 13/500, icon 15 `--foreground-subtle`:

| Label | Icon | Trailing | Active when |
| --- | --- | --- | --- |
| Home | `house` | none | Home tab is active, or no tab is open (background `--secondary-default`) |
| All topics | `layout-list` | none | All topics tab active |
| Juno | `sparkles` | "⌘J" mono 11 muted | Juno tab active |

Hover `--surface-hover`. ⌘-click opens in a new tab.

Hairline below: 1px `--border-default`, margin `12 16 10`.

### 2.3 Quick filters and views

Row padding `0 10 10`, height 28, never taller. Two parts: a horizontal scroller (flex 1, min-width 0) with the pills, gap 2, and the **Unread** toggle fixed at the right, 6px after the scroller. `docs/design/sidebar-views/` has the mock.

- **The scroller** (`PillRow` in `@juno/ui`): `overflow-x: auto`, no visible scrollbar, `overscroll-behavior: contain` (a sideways swipe at an end never reaches Back or Forward, a wheel never reaches the list). A vertical wheel over it scrolls it sideways. When it overflows, the side it can scroll toward fades over 16px (`--space-4`): a sticky gradient in `--background-subtle` at each end, shown by a `scroll-state` container query, so no script watches the scroll. Keyboard focus scrolls the focused pill into view.
- **Pills**, 28px, radius 8 (`Button variant="filter"`): selected bg `--secondary-default`, fg default; unselected transparent, fg muted, hover fg default. Weight 500 in both, so selecting never changes a width.
  - **All**: text.
  - **Channels** (`hash` 14) and **DMs** (`user` 14): icon-only, 28×28. Tooltip and accessible name "Channels" and "DMs".
  - **A view**: its icon 14 in a 28×28 pill when it has one (tooltip and name are the view's name), otherwise its name as text, at most 120px (`--filter-pill-max-width`) with an ellipsis.
  - **New view**: `plus` 14, 28×28, fg muted, tooltip and name "New view". Always last.
- **Dot**: 5px `--hl` at the pill's top right (4px in from the top and right edge), absolute so it moves nothing; only its opacity changes. Channels and DMs: the group has unread topics the sidebar would show. A view: one of its topics has an unread mention (plain unread does not count). Never on the selected pill. The name says it: "Channels, unread", "Bots, unread mention".
- **Picking**: on pointer down, like the rows. Picking a view clears the scope chip. A view's list follows the same rules as All, limited to its conversations; Unread narrows it as it does All.
- **Right-click a view pill** (native menu, §15.7): Edit view… · Move left · Move right · — · Delete view. Dragging a pill along the row reorders it (a 2px `--hl` caret shows where it lands); All, Channels, DMs and New view do not move.

**View sheet** (`ViewSheet` in `@juno/views`): a popover dialog anchored under the filter row, start-aligned, 300px (`--menu-width-browse`), padding 14, radius 13, `--pop-shadow`, gap 12. Opens from New view, Edit view… and New view… in Add to view. Four fields, nothing else:

1. **Name**: text field, 30px, placeholder "Name", at most 32 characters. Required.
2. **Icon**: "Icon" 11/500 muted, then a grid of 24px icon buttons (8 per row, gap 2) from the view icon set, the first cell "None" (`prohibit`). Selected: bg `--secondary-default`, fg default. Optional.
3. **Conversations**: a search field (30px, `magnifying-glass` 14, placeholder "Add channels and people") over a list, at most 200px tall (`--view-sheet-list-max-height`), scrolling. Chosen conversations first, each a 30px row with its channel icon or photo, name, and a check; then, while the field has text, matches from the New chat picker (`newChat.conversations`, channels, group DMs and DMs that exist). Clicking a row toggles it. "3 conversations" 12 muted under the list.
4. **Keep these out of All**: a checkbox (`Checkbox`, as macOS sheets use), 13px, with "They show only in this view." 12 muted under it.

Buttons at the bottom right: Cancel (ghost) and Save (primary), 28px; Save disabled until there is a name. Enter saves from the name field; Esc cancels. Saving a new view selects it. The sheet makes no change until Save.

### 2.4 Scope chip

Only when scoped to one channel. Row padding `0 16 8`. Chip 26px, radius 6, bg `--secondary-default`, padding `0 4 0 9`, gap 6, 12.5/500: channel icon 12 muted, name without "#", then a 20×20 close button (`x` 11, radius 4, hover `--secondary-hover`), accessible name "Show everything". Scoping sources: clicking a topic's context pill (§5), "Show its topics" in a channel menu, clicking a #channel chip in a message, ⌘K "show its topics" result.

### 2.5 Topic list

Scroll container, padding `0 8 16`, contained scroll.

- Sections: **Pinned** then **Recent**. Section label 11/500 muted, sentence case, padding `14 12 6`. "Recent" label only shows when a Pinned section exists.
- Sort: latest activity first within each section.
- Row gap 2px.
- Visibility rules (SPEC §5): hide when quiet (no activity in 7 days and no unread), resolved, a thread set to Never (unless it mentions you), or in an ignored channel. Pinned rows are always shown. Mark-as-unread brings a quiet row back.
- Prototype difference: a pinned row that is resolved stays visible with a green `circle-check` 14 before its title and no hover Resolve button. **[spec]** says resolving hides the row; decision needed (see summary).

### 2.6 Sidebar empty state

Centered, padding `48 16`, gap 8: title 14/500, body 13 muted lh 1.5, button 30px radius 7 `--secondary-default` 13/500 (margin-top 4).

| Condition | Title | Body | Button |
| --- | --- | --- | --- |
| Unread filter on, nothing unread | No unread topics | Your filters are hiding everything. Older and resolved topics are in All topics. | Clear filters |
| Channels/DMs filter or scope hides everything | No recent topics here | same | Clear filters |
| No filters, nothing recent | No recent topics here | Topics with activity in the last 7 days show up here. | View all topics |

## 3. Topic row

**Shows:** S01 (unread, mention, Main tag, selected), S02 (context menu), S14 (selected + mention), shot 02-row-hover-resolve, shot 20-rename-row, shots 52–53 (densities).

### 3.1 Anatomy (comfortable density, the default)

```
[tile 44]  [line 1: title ........................ time | Resolve]  height 22
           [line 2: Sender: preview, 1 line …........  @ | count ]
           [line 3: ⌗ channel   ○○○   ▢ 7   ]              margin-top 3
```

- Container: `role="listitem"` in a `role="list"`, `tabindex` (roving), named by the title (`aria-labelledby`), `aria-current` when selected; Enter and Space open it. Not a button: a button's children are presentational, which would hide the Resolve button inside. Flex, gap 12, align start, padding `11 12`, a fixed height of 88px (80 compact: `--density-row-estimate` plus the padding), radius 10, transparent. Hover `--surface-hover`. Selected (open in the active tab) `--secondary-default`.
- Tile: 44×44 (36 compact). Channel: first letter uppercase, 14/600, bg `--secondary-default`, fg subtle, radius 10. DM: person avatar, round, person colours (tokens §1.6). Group DM: first initials of each member ("ML").
- Line 1 (22px box, gap 6): title 14.5px (13.5 compact), weight 500 (600 unread), letter-spacing 0, single line ellipsis, `flex: 0 1 auto` so the icons stay visible. Then `bell-slash` 13 muted on a thread set to Never that shows because it mentions you. Spacer. Then time 12px tabular, muted (subtle when unread).
- Line 2 (gap 8): preview 13px lh 1.45, muted (subtle when unread), one line with an ellipsis (`Text truncate`; the full text is the tooltip while it is cut off). Text is "Sender: text" with "You:" for own messages and ">" quote lines stripped. Right column (gap 4, padding-top 1):
  - **@ tag** when the latest unread run mentions you: 18px, min-width 18, radius 6, bg `--hl-soft`, inset 1px ring `--border-strong`, "@" 11/500 subtle, title "Mentions you".
  - **count tag** = unread count: 18px, min-width 18, padding 0 5, radius 6, 11/500 tabular; unread row bg `--secondary-active` fg subtle; otherwise `--secondary-default` fg muted. Hidden at 0.
- Line 3 (12px muted, gap 12, margin-top 3): channel icon 12 + name (no "#"), on Main rows too (the prototype's "Messages outside threads" label is gone). Then the avatar stack (18px circles, −4 overlap, 1.5px `--background-subtle` ring, initials 7.5/600, up to 4 participants), on every row. Then optional tags in order (gap 6):
  - Main tag: 18px, padding 0 6, radius 6, 1px `--border-strong`, 11/500 subtle.
  - Reopened tag: same but filled `--secondary-default`, no border, title "New activity after it was resolved".
  - Then, on Main rows only, `chats-circle` 13 + the number of threads started since Main was last read (tabular, title "3 new threads"). Hidden at 0. No message count on any row.
  - The Resolve slot (22px) ends the line.
- Title text: manual title, else AI title, else first ~6 words of the first message with "…" (a cut on the end of a sentence keeps the sentence and adds no "…"; a final full stop is dropped). Main rows show the channel label ("#eng", "Maya Chen").

### 3.2 States

| State | Change |
| --- | --- |
| Read | Title 500, preview muted, time muted, no count tag |
| Unread | Title 600, preview subtle, time subtle, count tag `--secondary-active` |
| Mention | @ tag before the count tag (count may be absent) |
| Hover (pointer) / focus-within | Time stays. An icon-only **Resolve** IconButton (check icon, small size) appears at the right end of the meta line (line three), in a slot that is always reserved so nothing shifts. Tooltip "Resolve", accessible name "Resolve {title}". Not shown on resolved rows or while renaming. (Owner decision, overrides the prototype's text button that replaced the time.) |
| Focused (keyboard) | 2px focus ring; Resolve button visible; Enter/Space opens |
| Selected | bg `--secondary-default`; stays while hovered |
| Main | Main tag after the title; title is the channel label |
| Reopened | Reopened tag; row is back after a resolve |
| Thread set to Never (shown because it mentions you) | opacity .6, `bell-slash` icon |
| Resolved (pinned only) | green `circle-check` 14 before the title, no Resolve on hover |
| Renaming | Title replaced by input: 24px, margin −2 0, padding 0 6, 1px `--border-strongest`, radius 6, bg surface, 14/600; text preselected; Enter saves, Esc cancels, blur saves. Row click disabled |

### 3.3 Density (Preferences › Appearance)

| Density | Vertical padding | Line gap | Title | Tile | Row height |
| --- | --- | --- | --- | --- | --- |
| Comfortable (default; the prototype's "balanced") | 11 | 2 | 14.5 | 44 | 88 |
| Compact | 8 | 0 | 14.5 | 36 | 80 |

The preview is one line in both, so the row height is fixed (measured 10-15: 87.56 and 79.56px, rounded up to whole pixels; before, 107px with a two-line preview).

Density also changes the message list (§6.1). The prototype's "airy" level is gone.

[built M10] The `density` token group (`tokens.md`) holds the row padding, line three's gap, the tile zoom and the off-screen estimate, and the message padding and group gap; `compact` in `themes.stylex.ts` overrides them on `<html>`. Compact keeps the comfortable title size and line three's gap is 0 (comfortable keeps its 2px); the tile is the 44px tile drawn at 36px with CSS `zoom`. The message body stays 14.5.

### 3.4 Interactions

- Click: open in the current tab. ⌘-click: new tab. If already open in a tab, that tab is focused.
- Right-click / context-menu key: row context menu (§15.1).
- Hover Resolve: resolves, marks read, hides the row, toast "Resolved · {title}" with Undo. Main rows resolve the same way (toast uses the channel label).
- Peek (SPEC §5): hold the peek key over a row. [built M5] `PeekView`, 8px right of the sidebar, from under the title bar to 8px above the window's bottom, `--peek-width` 480px or the room the window has: a popover surface with a header (art 20, title 14/600, where 12 muted; a Main shows only its channel label) over New chat's read-only preview of the topic (`TopicPreview`: its newest messages, no "new" divider, plain reaction labels, nothing marked read), with no floating header over the list (`MessageList underHeader={false}`). It appears and closes at once, with no animation, and moves nothing. A non-modal `dialog` named by the title; focus stays where it was. Moving to another row switches it; moving off the rows, releasing the key, another key (Escape included), a click or leaving the window closes it. The wheel over the rows scrolls the peek. ⌥ also peeks the row with keyboard focus; Space only peeks by pointer, since Space opens a focused row.

## 4. Tabs

**Shows:** S01 (two tabs), `docs/design/new-chat/` (the strip with a pinned tab, an unread dot and the tab menu).

- Strip: 44px, align-items flex-end, padding 0 10, gap 2. [built M4] The tabs sit in a horizontal scroller with no visible scrollbar (`scroll-snap-type: x proximity`); the active tab scrolls into view when it changes, so it is never hidden. The "+" button sits outside the scroller and never leaves the screen. The prototype clipped the strip with `overflow: hidden`.
- Tab: `flex: 0 1 230px`, min-width 120 (`--tab-min-width`; the prototype's 72 lost the label), height 35, margin-bottom −1, padding `0 6 0 12`, radius `8 8 0 0`, 1px border, 13px, gap 8.
  - Active: bg `--background`, border `--border-default` with bottom border in `--background` so it merges into the page; fg default; weight 500.
  - Inactive: transparent, border transparent, fg subtle, weight 400; hover fg default.
  - Icon 14 at 0.75 opacity: channel kind icon for topics (`hash`/`lock`/`user`/`users`), `note-pencil` New chat, `house` Home, `layout-list` All topics, `sparkles` Juno, `bell` Notifications, `settings` Preferences.
  - Label: topic title, channel name for Main (no "#"), or the page name. Ellipsis.
  - Label: `dir="auto"`, so a right-to-left title shows its start, as the row and header do.
  - Close: 20×20, radius 4, `x` 12 muted, hover bg `--secondary-default`, accessible name "Close tab". Always visible on the active tab and on inactive tabs wider than 140px. [built M4] On a narrower inactive tab the label takes the button's space and the button appears over the label's end on hover or focus (Safari does the same), so nothing moves.
  - **Unread dot**: on an inactive topic tab whose topic has unread messages, a 6px round dot in `--foreground-muted` sits right after the label (before the close button), the same soft grey as unread counts. One style for everything; a mention does not change it. Never on the active tab (opening marks read) and never on pages.
- **Pinned tabs** sit first, in pin order, as compact icon-only tabs: 40px wide, the same height and radius, the 16px icon centred, no label and no close button; the title is the tooltip. A pinned tab's unread dot sits at the icon's top-right corner with a 1.5px ring in the strip background. Pinned tabs are saved with the other tabs.
- New chat button after the last tab: 28×28, radius 8, `plus` 15 muted, margin `0 0 4 4`, name "New chat ⌘T"; opens a New chat in a new tab (§8). [built] "+", ⌘T, ⌘N and the sidebar's New chat button focus an untouched New chat tab (no draft, no destination) instead of opening a second one. A topic opened in a New chat tab replaces the New chat in its history.
- Behaviour: everything opens in the current tab; ⌘-click or "Open in new tab" adds one. Pages (Home, All topics, Juno, Notifications, Preferences) are singletons: opening again focuses the existing tab. Closing a tab focuses the tab now at the same index (the right neighbour), else the last one. With no tabs the workspace shows the empty state (§17).
- **History.** Each tab keeps its own back and forward list, like a browser tab. An entry is one thing opened in that tab: a topic or a page. Opening something else in the tab pushes an entry and clears Forward. Scroll positions, peeks, popovers and the Juno panel are not entries; going back to a topic restores where you were in it from its saved scroll snapshot. A New chat that sends replaces its own entry with the topic, so Back never returns to an empty New chat. At most 50 entries per tab, in memory only. Back and Forward open the entry as an ordinary open (it marks read by the usual rule). Inputs: the buttons (§1), ⌘[ and ⌘], the mouse's back and forward buttons (`mouseup` buttons 3 and 4 in the renderer), and the three-finger swipe (`BrowserWindow` `swipe` event on macOS; two-finger swipe is not exposed to Electron apps).
- **Tab menu** (right-click any tab, native): Pin tab / Unpin tab · separator · Close tab (⌘W) · Close other tabs · Close tabs to the right · Close all tabs · and on topic tabs, separator · Copy Slack link · Open in Slack. [built] Each bulk close is disabled when it would close nothing. Copy Slack link copies the topic's link (`https://<workspace>.slack.com/archives/<channel>/p<root ts>`, the channel alone for Main); Open in Slack opens the channel in the Slack app (`slack://channel?team=&id=`), because Slack has no documented link to a thread. "Close other", "to the right" and "all" leave pinned tabs open, as browsers do; ⌘W or Close tab on a pinned tab closes it. Every close goes onto the reopen stack.
- **Reopen closed tab** (⌘⇧T): a stack of the last 20 closed tabs, in memory, each with its history. Reopening puts the tab back at its old index (or the end) and focuses it. A closed New chat with a draft also has the "Draft closed · Undo" toast; either path restores the draft.
- Keyboard: [built M4] the strip is an APG `tablist` with roving tabindex: only the active tab is in the Tab order; ArrowLeft and ArrowRight select the neighbour (wrapping), Home and End the first and last; Delete or Backspace on a tab closes it, and Enter or Space on its close button does too. Focus moves to the tab that takes the closed tab's place, or to "+" when none is left. Browser shortcuts from the app menu: ⌘T new tab (a New chat), ⌘W close tab, ⌘⇧T reopen the last closed tab, ⌘1 to ⌘8 go to that tab (pinned tabs count), ⌘9 the last tab, ⌃Tab / ⌃⇧Tab and ⌘⇧] / ⌘⇧[ next and previous tab (wrapping). The prototype had `role="button" tabindex="0"` on every tab, two Tab stops per tab.
- [built M4] `Workspace` in `@juno/views` draws the strip from `WorkspaceTab`s. The 16px icon slot is fixed in size and takes the topic's art (`art`, drawn at 16) in place of the kind icon (drawn at 15), so art drops in with no shift. Tab radius is 8 (`--radius-lg`).

## 5. Topic header

**Shows:** `docs/design/header/` (`b-light.png`, `b-dark.png`, `b-family-*.png`, `b-detail-*.png`), shot 22-header-more-menu (the menu the title now opens), `docs/design/juno-panel/` (the panel itself). SPEC §7 "Header" decides behaviour.

No bar and no rule. Two islands float over the top of the topic area (below the tab strip); the message list fills the whole area and scrolls under them.

- **Islands row**: absolute, top `--header-island-top` 8, height `--header-island-height` 36, capped at `--reading-width` (800) and centred, padding-inline 24 (the column's), `justify-content: space-between`, gap 8. The row has `pointer-events: none`; the islands have `auto`. On every width the islands' outer edges line up with the composer's.
- **Island**: `Surface kind="island"`: height 36, `--radius-pill`, bg `--surface-default`, 1px transparent border, `--card-ring` (light: the soft shadow; dark: the darker shadow on a surface one step above the page), padding 3, gap 2. Solid. No blur and no coloured border (tokens §5).
- **Band**: absolute, top 0, the full width of the topic area, height `--header-band` 68, `pointer-events: none`, `aria-hidden`. `linear-gradient(--background 0 to --header-band-solid 44, transparent at 68)`: solid behind the islands, then a 24px fade under them, so text never shows through or around an island. Static: no animation, no blur.

Left island (`flex: 0 1 auto`, `min-width: 0`, padding `3 3 3 5`):

- **Context pill**: `ContextPill size={24}`: `--radius-pill`, padding 0 8, gap 6, 12.5/600, icon 13, the channel name only, at most 160px with an ellipsis. The kind is the tint, the icon, the tooltip and the accessible name ("eng, public channel"). Click narrows the sidebar to the channel (§2.4); right-click opens the channel menu (§15.2). Never hidden.

  | Kind | Icon | Text | Colours |
  | --- | --- | --- | --- |
  | Public channel | `hash` | "eng" | `--tint-public` |
  | Private channel | `lock` | "hiring" | `--tint-private` (amber) |
  | Direct message | `user` | "Maya Chen" | `--tint-dm` (blue) |
  | Group DM | `users` | "Maya, Leo" | `--tint-dm` |

- **Title button**: 28px, `--radius-pill`, padding 0 8, gap 6: title 14/600 single line ellipsis, `dir="auto"`, then `caret-down` 12 muted. At least 72px wide; it shortens before the pill does. Hover `--surface-hover`; open `--secondary-default`. A menu button (`aria-haspopup="menu"`, `aria-expanded`) inside the page's `h1`. Click, Enter, Space or ↓ opens the topic menu (§15.1, the row's menu) anchored under the island, left-aligned, 6px below. The context-menu key and right-click open it too. Main's title is "Main".
- **Rename** (from the menu): the title button becomes an input in place: 28px, padding 0 8, 14/600, 1px `--border-strongest`, `--radius-pill`, bg `--surface-default`, preselected. [built M5] `RenameField size="header"` sizes to its text (`field-sizing: content`) from the title's 72px floor up to the island's room. Enter saves, Esc cancels, blur saves. Saving an empty title, or the same text as the AI title, clears the manual title. There is no double-click rename in the header.

Right island (`flex: none`, padding 3):

- **Resolve / Reopen**: 28px, `--radius-pill`, padding 0 10, gap 6, 12.5/500 `--foreground-default`, icon 14 subtle (`circle-check` / `rotate-ccw`), hover `--surface-hover`. Undo toast. Not on Main. [built M5] It runs the row check's resolve call, and Reopen runs `topics.reopen`.
- **Threads** (Main only, in Resolve's place): the same button, `chats-circle` 14, "Threads · 12". Opens the 300px `ActiveThreads` popover, anchored under it, right-aligned (§2 behaviour unchanged: rows are buttons named by the title and described by the counts; Escape closes and puts focus back on Threads).
- **Juno**: 28 round icon button (`sparkle` 16 duotone), a toggle (`aria-pressed`) for the panel (§12.1). Name "Juno ⌘J". Pressed: `--secondary-default`. Hidden when AI assist is off. [not built] Hidden until the Juno panel is built, since a button that does nothing is worse than none.
- Pin, Notify me and More are not in the header. They are in the topic menu, which is the row's menu.

Narrow (a container query on the topic area): under 480px, Resolve is a 28px icon button (name still "Resolve" / "Reopen") and Threads shows `chats-circle` and the count only ("12", name "Threads, 12"). The pill shows its full name up to 160px, then takes an ellipsis; the title takes the rest and shortens first. The pill's icon and tint always show. At the minimum window (720 by 480, sidebar shown) the topic is 336px and every variant fits.

The message list under the header (`MessageList`, `TopicView`):

- The scroller starts at the top of the topic area, under the band. Its content has `padding-top: --header-inset` 56 before the column's own 16, so at scroll top the first message starts at 72, below the band's end at 68.
- `scroll-padding-top: --header-band` (68), so keyboard focus moves, `scrollIntoView` and find-in-page stop below the islands.
- The scrollbar track starts below the band: `::-webkit-scrollbar-track { margin-top: --header-band }` on the message list's scroller only. The thumb never goes under an island.
- Open position: the "N new" divider lands `--header-band` + 80 (148px) from the scroller's top, which is 80px below the band, as before. The bottom pin, prepends, the window cap and scroll anchoring are unchanged (performance.md 3.3 and 5.2): the band and islands are out of flow and never change, so a rename, the menu or Juno pressed moves nothing in the list.
- No script reads or writes on scroll. The band is drawn the same at scroll top and scrolled: at scroll top it only covers the empty inset.

Keyboard order inside the header: context pill → title button → Resolve or Threads → Juno. Then the message list and the composer, as before (the Tab order row in the accessibility table).

## 6. Message list

**Shows:** S01 (flat, new divider, quote, mentions, reaction; its catch-up card is removed), S04 (thread link; its grouping card is removed), S14 (mention tint), S15 (dark), shot 07, 08 (hover toolbar, picker), shot 15 (selection quote), shot 19 (settled hint).

Scroll container `[data-scroll]` with contained scroll; inner column max-width 800, centered, padding `20 24 16`. The container mirrors its 10px scrollbar gutter on the left (`ScrollArea evenInset`), so the column is centred in the pane, not 5px left of it (`geometry.spec.ts`).

### 6.1 Flat messages

- Message: flex, gap 12, padding by density (Compact `2 8`, Comfortable `4 8`), radius 8, `tabindex="0"`. Hover bg `--surface-hover` (the same token as every other hovered row; the prototype's `--background-subtle` is 1.02:1 against the page and invisible). Mentions you: bg `--hl-soft` permanently.
- Grouping: consecutive messages by the same sender share one header. First of a group has margin-top 6/12 (Compact/Comfortable) unless it is the first message or sits right after the "new" divider. A quoted message always starts a new header.
- Avatar column 32px. Avatar 32 round, margin-top 2, initials 12/600, shown on the first message of a group.
- Header: name 14/600, time 12 muted, gap 8, baseline aligned.
- Body: 14 Compact, 14.5 Comfortable, lh 1.6, `overflow-wrap: anywhere`, `white-space: pre-wrap`, `text-wrap: pretty`; blocks stacked with gap 2. Selectable.
- Timestamps: "9:12" (same day), "Yesterday", weekday "Sat", "Oct 3".
- [built M6a] Sending. A message Juno has not got into Slack yet is a row at the end of the list, drawn exactly like the message it becomes, so the swap moves nothing. A send that takes longer than `--delay-pending` (800ms) fades the row's content to `--opacity-dim`. A send Slack refused keeps its text and shows a meta line under it: a `warning-circle` 14 in `--danger`, "Not sent." in `--danger`, then **Retry** and **Delete draft** as underlined text buttons, the line's size. The user's own messages, sent or still sending, never count as new in the pill and never take the "N new" divider.
- [built M4] `MessageList` and `Message`: Comfortable density only (padding `4 8`, radius 14, body 14.5/1.6). Hover bg is `--surface-hover`, the same fill as every other hovered row (the prototype's `--background-subtle` is 1.02:1 against the page, invisible). A cut-off sender name shows the full name as its tooltip on hover (`Text tooltipWhenTruncated`). A long code block scrolls inside its 150px box, and at its edges the wheel goes on to the list (no contained overscroll; a full-height block was tried and moved the list by a pixel on scroll, see `docs/design/reviews/m4/after/wp-c/README.md`). Blank lines in a message are tidied by `@juno/richtext`: a line of only spaces is a blank line, more than one blank line collapses to one, and none at the start or end. A continuation shows its time in the avatar column on hover or focus (tag size, muted). "edited" is a muted tag under the body; a broadcast reply says "also sent to the channel" after the time. A deleted message reads "This message was deleted." in muted italic; an unloaded root reads "Loading message". An emoji-only message (one to three emoji) is drawn at 1.75× the body size. Rows carry `content-visibility: auto` with `--row-message-estimate` (56px) and `contain: content`. Custom emoji are 1.25em images on the line; a `date` element is formatted in the reader's time zone ("Thursday at 14:00").

### 6.2 Inline chips

- **@person**: weight 600, padding 0 3, radius 4, bg `--hl-soft`, fg default. **@you**: bg `--hl`, fg `--hl-fg`. In your own bubble: `color-mix(currentColor 16%, transparent)`.
- **#channel**: same look as @person; clicking scopes the sidebar to that channel (stops propagation).
- Tokens are matched against known names ("@Maya Chen", "@Maya", "#eng"); longest first.

### 6.3 Quote block

Lines starting with ">" render as one block: margin 2 0, padding 4 10, radius 6, bg `color-mix(currentColor 6%, transparent)` (12% inside bubbles), colour `--foreground-subtle` (inherit inside own bubble), pre-wrap. Consecutive quote lines merge; empty text blocks are dropped. S01 shows one.

### 6.4 Reactions

Under the body, flex-wrap, gap 4, margin-top 6. Chip 24px, padding 0 8, gap 5, radius 6, 12px, emoji + count 500. Border 1px `--border-default`; mine: border `color-mix(var(--hl) 45%, transparent)` and bg `--hl-soft`. Hover border `--border-strongest`. Click toggles mine; a chip with zero reactors disappears. Each chip's accessible name says the count, the emoji and whether you reacted ("2 👍, including you"), since the emoji is hidden from assistive technology. [built M6b] Clicking a chip calls `messages.react`; the chip changes at once from the outbox row and settles with Slack's answer and the socket event in either order. A first chip grows its message at the bottom only; chips joining, counting and leaving a row of chips move nothing (gallery shift guards).

### 6.5 Hover toolbar

Appears on hover or focus of a message: absolute, top −14, right 8, z 2, padding 2, gap 2, radius 9, bg `--surface-default`, `--pop-shadow`. Measured 191×34.

Contents: three quick reactions 👍 ✅ 👀 (28×28, radius 6, emoji 15px, name "React 👍") · 1px separator (`--border-default`, margin 4 2) · **More reactions** (`smile-plus` 16) · **Quote** (`quote` 16) · **Reply in thread** (`message-square-reply` 16, Main threads only). Hover bg `--surface-hover`.

Picker: clicking More replaces the toolbar contents with 12 emoji (👍 ❤️ 😂 🎉 👀 ✅ 🙏 🔥 💯 😮 😢 🚀), 28×28 each, width 364. Esc or leaving the message closes it. [proposed] v1 ships this fixed set; a full emoji picker is a later addition.

[built M6b] SPEC 7 asks for the full picker, so More reactions opens `EmojiPicker` (`--emoji-picker-width` × `--emoji-picker-height`): a search field over names and aliases, Frequently used (this session's reactions, the quick three first), then every standard emoji in Slack's categories with Slack's names (`@juno/richtext` `emoji-catalog.ts`, generated by `scripts/emoji-catalog.mjs` from emoji-datasource 16). The container floats it under the toolbar, or above it near the bottom of the list, outside the rows (`TopicView` `floating`), since rows have paint containment; its chunk loads after the first topic paints. Enter in the search picks the first match, arrows move in the grid, Esc or a press outside closes it. Picking an emoji you already reacted with takes it off. Workspace custom emoji are not offered yet. The toolbar also ends with **More** (`dots-three` 16), the message menu (15.4); with it the Main toolbar measures 223px and `--toolbar-reserve` is 243px. A continuation row's toolbar shows over the end of its first line, as Slack's does. Delete on your own message replaces the toolbar's contents with "Delete this message?", Cancel and Delete ↵ until it is confirmed or cancelled (ADR 0010); the row keeps its hover look meanwhile.

[built M4] `HoverToolbar` is the shell: `Surface toolbar` (radius 16, `--pop-shadow`, padding 4), 28px buttons with radius 12 (`EmojiButton` for the three reactions, `IconButton` for `smiley`, `quotes` and `arrow-bend-up-left`), a 1px vertical rule between. It sits at the row's top right (top 2, right 8), hidden with opacity and visibility until the row is hovered or has keyboard focus, so showing it moves nothing and a hidden one never takes the pointer. [10-15] Messages have one rhythm everywhere: the header is no taller on a row with a toolbar. The header keeps `--toolbar-reserve` free at its end, so the name and time are never under the toolbar; the toolbar covers the end of the first body line on hover, on header and continuation rows alike. A row under 464px wide (`@container message`) gives its whole header line to the name and time, and the toolbar rises to sit wholly above the row's top edge, over the end of the row before, as Slack's does. Rows keep their paint containment; `overflow-clip-margin` (`--toolbar-height` + 8) lets the raised toolbar and its shadow paint above the row. M6b mounts it on every message of a topic tab (not in previews).

### 6.6 Selection quote

Selecting text inside a message (`[data-msg-text]`) shows a floating **Quote** button centered 38px above the selection: 30px, padding 0 10, gap 6, 1px `--border-default`, radius 8, bg surface, `--shadow-md`, `quote` 14 + "Quote" 12.5/500, z 35. Mouse-down on it inserts "> {selection}" lines into the composer, clears the selection and focuses the composer. Any other mouse-down dismisses it. [built M6b] `SelectionQuote` in a `Floating` layer over the list: shown when a mouse or Shift-arrow selection ends inside one message list's text, hidden when the selection collapses or the list scrolls.

### 6.7 Thread link (Main only)

Under a Main message that has a thread: button 26px, margin-top 6, padding `0 8 0 6`, gap 6, 1px `--border-default`, radius 6, bg surface, fg subtle, 12.5px, max-width 100%: `messages-square` 13 · "2 replies" 600 default ("1 reply", "Thread" when only the root) · title ellipsis · `chevron-right` 12. Hover border `--border-strongest`. Click opens the topic (⌘-click new tab). [built M4] A cut-off title shows the full title as its tooltip on hover.

### 6.8 New divider

- Divider at the first unread message (never before the first message): margin `14 0 6`, gap 10, "3 new" 11.5/600 in `--hl`, then a 1px rule `color-mix(var(--hl) 30%, transparent)`. The list opens scrolled so the divider sits 80px from the top; otherwise it opens at the bottom.
- [built M4] `NewDivider` (a `LabelledRule`) goes before `dividerBefore`; the message after it starts a group with no top margin. `NewMessagesPill` is a raised 28px button ("2 new messages", "Jump to latest", `arrow-down`) that `TopicView` floats 12px above the list's bottom edge. Image thumbnails: a box of the final size (from `thumb`'s dimensions, capped at `--thumb-max-width` × `--thumb-max-height`, radius 12, `--secondary-default` behind) with the image fading in; a failed image keeps the box and shows an `image` glyph. Other files are 360px `Surface inset` cards (radius 12) with a kind icon, the name and "PDF · 1.2 MB"; a deleted file reads "File no longer available".
### 6.9 Settled hint (threads)

Card at the top of a thread when AI thinks it is settled: margin-bottom 16, padding `10 10 10 14`, radius 10, `--card-ring`, 13px, gap 10: `sparkles` 14 muted · "Looks settled. Priya is shipping two-line previews as the default." subtle · **Resolve** 28px secondary 12.5/500 · **Not yet** ghost. Hidden once dismissed, resolved, or AI assist is off. Shot 19.

## 7. Composer

**Shows:** S01 (empty "Reply"), S04 ("Message #eng"), S05 (route check), S06 (clarity check), shot 11-audience-guard, shot 12/13 (@ and # suggestions), shot 14 (grown).

- Outer padding `8 24 20`; inner wrapper max-width 752, centered, `position: relative`.
- Box: bg `--surface-default`, 1px `--input-border`, radius 12, overflow hidden. Rows inside: optional guard line, optional check bar, then the input row.
- Input row (align end, gap 4), field padding `0 6 0 14` so the text starts 18px in, as in the Juno composer: textarea 1 row, padding `9 4`, 14px, lh 22px, min 40px, grows to 194px **[spec: ~8 lines]** then `overflow-y: auto` · **Send** 28 round bg `--hl` fg `--hl-fg` `arrow-up` 16, margin `6 6 6 0`, opacity .4 when the draft is empty (not disabled, so it stays focusable; [proposed] set `aria-disabled`).
- Placeholder: "Reply" in threads, "Message #eng" / "Message Maya Chen" in Main. No helper text anywhere.
- [built M4] `ComposerSlot` holds the place at the single-line height (40px field in the 752px column, padding `8 24 20`): the send mark is drawn inert and the placeholder is muted body text, starting where the composer's text does. M6 swaps the composer in with no shift.
- Drafts are kept per topic and survive tab switches.
- Keys: Enter sends; Shift+Enter newline. Sending clears the draft, marks the topic read, and reopens it if it was resolved.
- [built M6a] Every topic tab has the `Composer` (the New chat one): the field grows to 194px and then scrolls inside, Enter sends, Shift Enter adds a line, and the send button is dimmed while the draft is empty. There is no attach control until attachments land (10-15: a mark that did nothing was removed); `Composer`'s `leading` slot is where the Attach button goes, 28 round `plus` 18 subtle with the field's start padding back to 6. Until the topic's draft has loaded, the `ComposerSlot` holds the place. Drafts live in the engine per topic (`drafts.get`, `drafts.set`), written 400 ms after typing pauses and when the tab hides, so they also survive a restart. Sending clears the field at once, scrolls the list to the bottom and marks the topic read; a resolved topic reopens when the message lands. @ and # suggestions are not built yet: the field is plain text.

### 7.1 @ and # suggestions

Typing `@` or `#` at a word start opens a popover above the composer: `bottom: calc(100% + 6px)`, left 12, width 280, z 5, padding 6, radius 13, `--pop-shadow`. Heading "People" / "Channels" 11 muted, sentence case. Up to 6 rows, 32px, radius 6, padding 0 8, gap 10, 13px: avatar 20 or `hash`/`lock` 15 muted, name, right sub 11 muted (channel kind). Highlighted row bg `--surface-hover`. Filters as you type. ArrowUp/Down move, Enter or Tab inserts "@Maya Chen " / "#eng " and moves the caret, Esc closes, blur closes. DMs are not offered after "#".

### 7.2 Audience warning

While typing in a **public** channel, if the draft matches hiring/people terms (offer, salary, comp, candidate, layoffs, performance review, headcount, fired, onsite), a line appears at the top of the box: margin `8 8 0`, padding 6 10, radius 6, bg warning-14% over surface, text warning-45% over fg, 12px, `sparkles` 13: "This reads like hiring or people detail. eng is a public channel." Disappears as soon as the draft stops matching. Not a block.

### 7.3 Send checks

On Enter (AI assist on) the draft is checked, route first (Main only), then clarity. If nothing is found it sends. If something is found a bar appears inside the box above the input: margin `8 8 0`, padding `8 8 8 12`, radius 8, bg `--surface-hover`, 13px lh 1.45, gap 10. Esc returns to editing (bar closes, draft unchanged). Editing the draft also closes it. Enter takes the first option.

| Check | Icon | Text | Confidence | Primary (Enter) | Secondary |
| --- | --- | --- | --- | --- | --- |
| Wrong place | `messages-square` 14 subtle | "Looks like a reply to **Staging bill doubled since August**" | mono 11 muted "97%" | **Post in thread ↵** | Send to Main |
| Clarity (fixes) | `spell-check` | "3 fixes: **recieve → receive, the the → the, add ?**" ("1 fix:") · optional " · One sentence runs over 40 words." muted | "90%" | **Fix and send ↵** | Send as is |
| Clarity (long only) | `spell-check` | "Reads a bit long. One sentence runs over 40 words." | "74%" | **Send ↵** | Keep editing |

Buttons: primary 28px, padding 0 10, radius 6, bg surface, `--shadow-sm`, 12.5/500, with "↵" mono 10.5 muted; secondary ghost 28px, fg subtle, hover bg `--secondary-default`. "Post in thread" posts into that topic, clears the draft and shows the toast "Posted in {title}" with Undo. "Send to Main" sends skipping the route check (clarity still runs). Fixes are minimal (typo table, doubled words, lowercase "i", missing "?"), never rewrites. Checks compare against the last 3–4 open topics in the channel.

### 7.4 Quoting

Quote (toolbar) inserts the whole message as "> " lines; selection Quote inserts only the selection. Inserted at the end of the draft on its own lines, caret after, composer focused. [built M6b] The whole message is the body's text as the list draws it (mentions as names). The quote goes after the draft's text on a new line, every line starting "> ", then a fresh line for the reply, with the caret there.

### 7.5 Inline edit and the keyboard [built M6b]

Edit (E on your own selected message, or Edit in the message menu) replaces the message's body with `InlineEdit`: a field (`Surface field`, the composer's growth limit) holding the message as composer text (`editText`), focused with the caret at the end, and Cancel and Save ↵ under it, right-aligned. Enter saves, Shift Enter adds a line, Esc cancels; both put focus back in the composer. The field stays until the list shows the new text, so the old text never flashes. ↑ in an empty composer focuses the newest message row; ↑ and ↓ move between rows and Esc goes back to the composer. On your own selected message Delete or Backspace opens the toolbar's delete confirm; Enter confirms, Esc cancels and keeps the row selected.

## 8. New chat

**Shows:** `docs/design/new-chat/` (`new-chat-light.png`, `new-chat-dark.png`). SPEC §9 decides behaviour.

A tab with the message list's area on top and the composer at the bottom, like a topic without its header.

- **Tab**: icon `note-pencil`; label "New chat" until a destination is picked, then the destination's label (the thread title, or "eng" / "Maya Chen" for Main), still with `note-pencil`. After the first send it is an ordinary topic tab.
- **Empty state** (no destination): the list area holds one line, centred vertically, 14 muted, "Write your message, then pick where it goes." No illustration, no buttons.
- **Picker row**: directly above the composer box, inside its 752px column, margin-bottom 8, gap 6, left-aligned. Two buttons, each 28px, `--radius-pill`, padding `0 8 0 10`, gap 6, 12.5/600, a trailing `caret-down` 12 muted:
  - **Conversation**: unset, bg `--secondary-default`, fg subtle, `at` 13 + "Pick a conversation". Set, it is the context pill (§5) for that conversation, with the same tint and icon and the name, plus the caret. [built] No kind text after the name, following SPEC §7: the tint and icon say the kind, and the list rows still say it in their sub line.
  - **Thread**: bg `--secondary-default`, fg default; `message-square` 13 + "Main" (default once a conversation is set), or `chats-circle` 13 + the thread's title (ellipsis, max-width 260). With no conversation: "Any thread", fg subtle.
  - Names "Conversation: {value}" and "Thread: {value}". In the Tab order before the composer; Space, Enter or ↓ opens.
- **Picker popover**: opens above its button (`bottom: calc(100% + 6px)`), 340px, radius 13, `--pop-shadow`, overflow hidden. Search header as ⌘K's at small size (padding `10 12`, `magnifying-glass` 14 muted, input 13px, border-bottom 1px `--border-default`), autofocused. List padding 6, max-height 360, contained scroll; headings 10.5/500 uppercase muted, padding `8 10 4`.
  - Conversation rows 36px, radius 8, padding 0 10, gap 10: kind icon 15 muted or avatar 20 · name 13.5 · sub 12 muted at the right ("Private channel", "Group DM", "No messages yet" for a person never messaged). Sections: **Recent** (8, by activity), then with a query **Channels** and **People**. Ignored channels are left out.
  - Thread rows 44px, radius 8, padding `4 10`: title 13.5/500 ellipsis over "#eng · 12 replies · 4m" 12 muted. First row **Main** (`message-square`, sub "Messages outside threads") when a conversation is set. With no conversation: **Recent threads** across everything, each sub naming its conversation; picking one also sets the conversation.
  - Active row bg `--surface-hover`; ↑ ↓ move, Enter picks, Esc closes and returns focus to the button, typing filters. Empty: "No match." 13 muted, padding 14 10.
- **Preview**: the message list (§6) for the destination, opened at the bottom, read-only: no hover toolbar, no selection Quote, reactions shown but not clickable, no "new" divider, nothing marked read. A person never messaged: centred 14 muted "This is the start of your conversation with Jonas Weber." Switching destination swaps the list in one frame from the local cache; a destination not yet cached shows the list's loading rows.
- **Composer**: §7, placeholder "Message" until a destination is set, then the destination's own placeholder. Send checks run against the destination (§7.3). Enter with no destination opens the conversation picker with the draft kept.
- **After send**: the picker row is removed and the topic header (§5) appears in the same frame the sent message appears; the tab becomes the topic. Nothing else moves: the composer keeps its place.
- **Closing with a draft**: toast "Draft closed" with Undo (reopens the tab with the draft and destination).
- [built] The composer is a plain text field (Enter sends, Shift Enter adds a line); attachments, @ and # suggestions and drafts that outlive the app are M6, and the send checks are M8, so a New chat sends without them for now. The message is posted before it shows: the tab becomes the topic once Slack has accepted it and the store holds it, with no pending row, and a failed send keeps the draft. ⌘⇧T on a New chat brings back its draft and destination from memory; the "Draft closed" toast is not wired yet.

## 9. ⌘K palette

**Shows:** S07 (send command), shot 04 (recent), shot 05b (resolve command), shot 05c (people search), shot 62 (dark).

- Overlay: `position: absolute; inset 0`, bg `rgba(27,28,21,0.16)`, z 30, click closes. Panel 560px (max calc(100% − 48px)) at top 96, radius 14, `--pop-shadow`, overflow hidden.
- Header: padding 14 16, border-bottom 1px `--border-default`, gap 10: `search` 18 muted · input 15px, placeholder "Search, or tell Juno: message maya the slot works" · kbd "esc" (mono 10, padding 1 5, 1px `--border-strong`, 2px bottom, radius 4, subtle).
- List: padding 6, max-height 400, contained scroll. Heading 11 muted, sentence case, padding `8 10 4`: **Recent** (empty query), **Results** (search), **Juno** (a command is recognised). Rows: padding 8 10, radius 8, gap 12, measured 55px: icon 16 muted · label 14 ellipsis + sub 12 muted · optional confidence badge · hint 11 muted on the active row only. Active row bg `--surface-hover`; mouse hover moves the active row.
- Empty query: 6 most recent topics (Main rows read "Main · #alerts-prod", sub "#alerts-prod · 3m").
- Search (titles, message text, channels, people), up to 8 results:
  - Topic: label = title, sub = "#eng · 4m" or "#eng · Leo: matched text".
  - Channel/DM Main: label "#eng" or "Message Maya Chen", sub "Public channel · Main" / "Direct message · Main".
  - Scope: label "#eng", sub "Public channel · show its topics" with `list-filter` icon.
  - Empty: "No matches." 13 muted, padding 20 10.
- Commands (top row, heading "Juno", with badge: 20px, radius 5, bg `--secondary-default`, `sparkles` 11 + "95%" 11 subtle, title "Juno's read of what you typed"):

  | Input | Label | Sub | Icon | Hint |
  | --- | --- | --- | --- | --- |
  | "tell/message/ask/dm/ping maya …" | Send to Maya Chen | "the wednesday slot works" | `send` | ↵ Send |
  | "message maya" (no text) | Message Maya Chen | Opens your Main thread with Maya | `message-square` | ↵ |
  | "post/send/say in #eng …" | Post in #eng | "…" | `send` | ↵ Send |
  | "summarize …", "catch me up", "tl;dr", "what did I miss" | Ask Juno to summarize … / catch you up | Opens Juno with this request | `sparkles` | ↵ |
  | "resolve pricing" | Resolve Pricing page copy | #product · hides it until there is new activity | `circle-check` | ↵ Resolve |
  | no DM exists | Message Jonas Weber | Starts a conversation | `user` | ↵ (opens a New chat addressed to them, §8) |

  A send command posts straight into that Main with the toast "Posted in Maya Chen · Main" and Undo (⌘Z). Search results still follow below the command (up to 6).
- Keys: ⌘K toggles (also closes). ArrowUp/Down move; Enter runs the active row; ⌘Enter opens a topic result in a new tab (hint "⌘ Enter for new tab"); Esc closes. Input is autofocused.

## 10. All topics page

**Shows:** S09, shot 40b (Resolved filter), shot 40c (empty), shot 64 (dark).

[built] `containers/AllTopics.tsx` (a lazy chunk) over the `AllTopics` view; the gallery has its states. Text sizes come from the nearest type roles: the title is `bodySmall` (14), the preview `meta` (12.5), where and the numbers `ui` (13.5).

- Header: padding `32 40 16`, gap 18, border-bottom 1px `--border-subtle`. Title "All topics" serif 32 lh 1.1; sub "Everything you're part of, including quiet, resolved and unfollowed topics." 13 muted. Right: search field 260×34, radius 8, 1px `--input-border`, `search` 14 muted, placeholder "Filter by title or message", 13px. Wraps under the title on narrow windows.
- Filter row (gap 2, wraps): status chips 28px radius 7 padding 0 10 13/500 with the count in 400 muted: **All 21 · Open 15 · Resolved 1 · Quiet 4 · Unfollowed 1**. Selected bg `--secondary-default` fg default; others transparent muted. Right: three selects 30px, radius 7, 1px `--input-border`, bg surface, 13px: "Channels and DMs | Channels | DMs", "Anywhere | #eng | … | Maya Chen" (the conversations of the kind that have topics, channels then DMs, by name; a new kind drops a place of the other kind), "Most recent | Oldest first | Most messages". Native `<select>`. The text filter finds words in titles and in any message of a topic, each word a prefix.
- Table: padding `4 28 40`, horizontal scroll on narrow windows (under `--all-topics-table-min`, 576px). Grid `minmax(200px,1fr) minmax(0,150px) 104px 44px 84px` (`--all-topics-columns`), gap 16. The header row is sticky. A virtual list (performance 3.5): rows the engine has not sent yet are placeholders with the row's geometry. Header row 11/500 uppercase 0.06em muted, padding 10 12: TOPIC · WHERE · STATUS · MSGS (right) · UPDATED (right).
- Row: `role="row"` in a `grid` with `aria-rowindex`, height 52, padding 8 12, radius 8, border-bottom 1px `--border-subtle`, hover `--surface-hover`. ↑ and ↓ move between rows (roving tabindex), Enter opens.
  - Topic: title 14 (600 unread, else 500) ellipsis, a Main row's title is its channel label ("#eng") + Main tag + `pin` 12 muted if pinned; preview "Sender: text" 12.5 muted ellipsis. Rename from the menu turns the title into the rename field, as on a sidebar row.
  - Where: channel icon 13 + name, 13 subtle.
  - Status chip 22px, padding 0 8, radius 6, 12/500: Open (`--secondary-default` / subtle), Resolved (success tint), Quiet and Unfollowed (transparent, muted).
  - Msgs 13 subtle tabular right; Updated 13 muted tabular right ("3m", "1h", "Yesterday").
- Click opens (⌘-click new tab); right-click gives the row context menu, so Reopen and Notify me (following again) happen here. Empty: "No topics match these filters." with the `nothing-here` illustration and Clear filters, which resets the chips, selects and text.
- Status definition: resolved → Resolved; a thread set to Never (not followed in Slack) → Unfollowed; older than the quiet window and not pinned/unread → Quiet; else Open. A thread Slack never said anything about (never followed) is Open. Ignored channels are excluded; archived channels the user is in are listed.

## 11. Home

**Shows:** `docs/design/home/` (layout A; `home-variants-*.png`, `in-context-*.png`). SPEC §12 decides behaviour; the home README has the copy, scene rules, ranking and sizes.

- Opens from the sidebar's Home item as a singleton tab (`house`), and shows without a tab when no tab is open. [built] Layout A (`Home` and `HomeScene` in `@juno/views`, `containers/Home.tsx`): scene 120×83, greeting (serif 36 line and sans line), up to three item rows (52px each, in the 480px `--home-width` column; two on a window shorter than 600px), the Ask Juno field (a 40px pill button with ⌘J). A row is the topic's art (40), a title line (13.5/500, one line, ellipsis) and a meta line (12.5 muted: topic title · place · time, or "N new" for Moved a lot); the caret shows on hover and keyboard focus. Until the first sync has finished, Home is blank rather than "All caught up". "Browse all topics" (caught up only) opens the All topics tab on mouse down, ⌘ for a new tab. Ask Juno waits for the Juno tab: the button is there and does nothing yet.
- Item kinds: Waiting on you, Pick up where you left off, Moved a lot, Follow-up and Tidy up (the last two with AI assist on). The two that came from For you carry one trailing button, 26px ghost 12.5/500, shown on hover and focus in a reserved slot so nothing shifts: **Mark done** (Follow-up; toast "Follow-up done", no Undo) and **Resolve all** (Tidy up; toast "Resolved 3 topics" with Undo). Tidy up's title line reads "3 topics look settled" and its meta line lists their titles (ellipsis); the row itself does not open anything.
- Everything else from the For you page is gone: the page, its nav count, the Coding agent prompt block, reply starters and reply ideas, and Dismiss.

## 12. Juno chat

**Shows:** S11 (empty), `docs/design/juno-chat/mock.html` (bubbles, status bubble, cards, states; renders `mock-light.png`, `mock-dark.png`). SPEC §13 decides behaviour; the view models are `@juno/agent-contract` `src/chat/`.

The chat's scroll container mirrors its scrollbar gutter on the left, as the message list does, so the column is centred in the pane.

One long list, no "new chat". Scroll container under the header islands (§5); column max-width `--page-width` 720, padding `40 32 24` below the `--header-inset`. The list is virtualised (`@tanstack/react-virtual`); it opens at the "New" divider when there are unread Juno messages, otherwise at the bottom, and shows the "New message" pill (§6) when scrolled up and something arrives. Row kinds are the `ChatItem` union: owner bubble, Juno bubble, status bubble, note, group label, day separator, New divider.

- **Empty state** (padding-top 40, gap 18): `juno` illustration 40 (`--illustration-figure`) · "What do you need?" `--text-display` serif 38 · body 14 lh 1.6 subtle max-width 520: "Ask me to find, summarize, catch you up or tidy up. I can read your topics and propose messages, but nothing is sent until you press Send." · four suggestion pills (wrap, gap 8): 34px, padding 0 12, 1px `--border-strong`, `--radius-pill`, bg surface, 13px: "Catch me up on today", "Summarize this topic", "Draft a reply in this topic", "Anything settled I can resolve?" (`chatCopy.empty.suggestions`). Clicking sends the text. Staggered entrance per friendly-layer §5.
- **Spacing**: 2px between bubbles of one group, 8px between groups plus the 18px line slot under each group's last bubble (where a delivery or ending line goes, reserved so a line arriving or leaving moves nothing), 20px around a day separator or a group label.
- **Owner bubble**: align end, max-width 76%, padding `8 12`, `--radius-bubble` 16 with the 4px tail on the bottom-right corner of the last bubble of a group (`group: last | single`), 14 lh 1.55 pre-wrap, selectable. Fill and text from the `chat` tokens `--owner-bubble-bg` / `--owner-bubble-fg`, set to option B (`--hl-bubble` / `--foreground-default`), the owner's choice of 10-14 from `docs/design/juno-chat/README.md`; the gallery's `OwnerBubble` "compare-a-to-d" state shows all four through the real component. Time on hover: 11.5 muted, left of the bubble. Delivery line under the bubble, 12.5 muted, right-aligned: "Waiting for network", "Waiting for Resume" or "Waiting for your review"; "Not delivered · Try again" with Try again as a text button in `--foreground-default`; the too-long line in full. A message sent while Juno works looks like any other (no Queued line). The row key is `opId`; `id` arrives once the message is stored.
- **Juno bubble** (`JunoBubble`, one row per bubble): row, gap 10: mark 28 (`--avatar-28`, the seated j in `currentColor` `--foreground-subtle`, no warm layer) beside the last bubble of a group, an empty 28 column otherwise · bubble max-width 76%, padding `8 12`, `--radius-bubble` 16 with the tail bottom-left on the last of a group, bg `--surface-hover`, text `--foreground-default` 14 lh 1.55, plain text, any length · the time on hover · **React** (`Smiley`) and **Reply** (`ArrowBendUpLeft`) 26px icon buttons, muted, their space always reserved and shown by opacity on hover or keyboard focus in the row. A citation is underlined text in `--foreground-subtle`; click scrolls to the cited message and flashes it with `--hl-soft` for `--duration-appear`. A Slack source (SPEC 13.1) looks the same; click opens its topic at the message in the current tab with the same flash, ⌘-click in a new tab; its tooltip is the place and time ("#eng · 14:02"). Each bubble arrives whole (never streamed, no cursor glyph) and fades in at full size over `--duration-appear`; a new bubble is a new row and moves nothing above it. The 18px slot under a group's last bubble is kept, empty, as on the owner's side.
- **Reactions** (`ReactionBadge`): the emoji themselves in a pill out of flow over the item's top corner (`top` and the side inset `-1 × --reaction-offset` 10px): on Juno's bubbles and cards at the top right (the owner's), on the owner's bubbles at the top left (Juno's). Height 22, padding `0 6`, `--radius-pill`, bg `--surface-default`, 1px `--border-subtle`, `--shadow-sm`, 12.5 meta text, at most one emoji per side. Each emoji's name is "Reacted {emoji}". A reaction arriving or leaving moves nothing.
- **Reaction picker** (`ReactionPicker`, in a `picker` popover at the React button or from the context menu): a row of 8 quick emoji as 28px `EmojiButton`s (👍 ❤️ 😂 🎉 🙏 👀 ✅ 😮; the owner's current one on `--surface-active`, picking it again removes it) and a 30px field "Any emoji" that takes exactly one emoji on Enter (the macOS emoji picker works in it; anything else marks the field invalid). A thumbs up is only recorded; any other emoji goes to Juno.
- **Reply quote** (`QuoteStub`): one line above the replying bubble, 12.5 muted, a 2px `--border-strong` bar at the start, the sender 500 subtle ("Juno" for a bubble or card, "You" for an owner message) · the agent's preview, ellipsis; on the owner's side right-aligned within the bubble width, on Juno's past the mark column, 2px above the bubble. Click scrolls to the original and flashes it. A removed target reads "Removed". In the composer the same stub sits above the field, lined up with its text, with a 20px `x` ("Remove quote"); Esc clears it before it closes anything else.
- **Ending line** (`EndingLine`, its own row under the run's last bubble or card): 12.5 muted, past the mark column, from `chatCopy.ending`: "Juno was interrupted. Your message is kept. Try again" (Try again as a text button, only when the ending carries a retry); the four failed lines, with Try again the same way; the two blocked lines in full. A run that ended `complete` has no row.
- **Cards** (`CardRow`, one row per card, under the run's bubbles, past the mark column, with React and Reply beside it and reactions on its top corner): margin-top 8, max-width 560, `--radius-card` 20, bg `--surface-default`, `--card-ring` (light: the wide soft shadow; dark: the ring), padding 14 16, gap 10, `--duration-appear` fade at full size (no height change). Header 12.5 muted, gap 8: kind label 500 · "·" · source (a context pill 22px for Send message, "T3 Code asks" for a session question) · spacer · Dismiss as a 22×22 `X` 12 bold where the card has Dismiss. Body 14 lh 1.55. Footer: buttons 30px, `--radius-lg`, 13/500, gap 6, right-aligned; the primary is bg `--hl` fg `--hl-fg` for Send and Apply, `--secondary-default` for Resolve, Connect, Keep, Start, Allow; others ghost subtle. The "Because" line, when present, is 12.5 muted above the footer, prefixed "Because ". `status.working` dims the footer to `--opacity-disabled`. After-lines replace the footer: 12.5 muted, with "Undo" or "Open" as underlined text buttons. `expired`: "Expired · Ask again". `unknown` (kind): one line "This card needs a newer Juno". `open` with `mayHaveHappened`: "This may already have happened." 12.5 muted above the footer.
  - **Send message**: one row per message, divided by `--border-subtle`: context pill (icon 11, 600 name, 400 kind) · "in {topic title}" 12.5 muted when `inTopic` · textarea 2 rows, padding 8 10, `--radius-lg`, 1px `--input-border`, bg `--background`, 14 lh 1.55, editable until Send. After Send, per row: text 14 subtle, then "Sent · Open" or "Failed" 12.5 muted, with no button: the card runs once. "Failed" covers a rejection and a send Juno could not confirm. The card's own after-line comes from `sendMessageStatus`: "Sent 3", "Sent 1 of 3" (`chatCopy.card.sendMessage.sentCount` / `sentOf`) or "Failed"; the footer stays dimmed while any row is unresolved.
  - **Resolve**: "Resolve 2 topics" 12.5 muted; rows 13.5 with a channel icon 13 + title + where 12 muted. After: "Resolved 2 · Undo".
  - **Topics**: padding 8, rows 36px (`--control-36`), padding 0 10, `--radius-xl` 12, hover `--surface-hover`: channel icon 13 muted · title 13.5/500 · where 12 muted. Click opens, ⌘ click in a new tab. No footer.
  - **Task**: title 14/500 · project and branch 12.5 muted ("juno · fix-sidebar-flake"; a subagent shows its model, "Juno · Haiku") · state line 13 subtle that swaps text with a 150ms cross-fade and never reflows (fixed one-line height, ellipsis). The card has no `status`; `phase` drives it. `lostSight`: the state line reads "Sign in to T3 Code to keep watching" and Open becomes Sign in. Footer: Open ghost · Stop ghost danger text (`--danger`). After, from `chatCopy.card.task`: "Done · Open PR 412", "Failed · Show in Activity", "Stopped". Stop is the Task card's own control and ends the running job; it is not a chat Stop.
  - **Proposed task**: the same title, then the project and the branch it starts from ("juno · from main"), no state line. Footer: Start secondary · Dismiss. After: "Started".
  - **Question**: header from `asks`: "Juno asks", or "T3 Code asks" + job pill; prompt 14; options as full-width buttons min-height 36, padding `6 12`, 1px `--border-default`, `--radius-xl`, 13.5 lh 1.45, left-aligned, hover `--surface-hover`; a reply field below when `freeText` (one line, grows, `--input-border`, `--radius-lg`) with Reply 30px secondary. After: "You chose {label}" or "You replied".
  - **Schedule**: what 14/500 · when 13 subtle · "Notifies you" or "No notification" 12.5 muted. Footer: Keep secondary · Pause ghost · Delete ghost. After: "Kept", "Paused", "Deleted".
  - **Proposed schedule**: the same body, then the prompt each wake runs, in full, 13 subtle in a `--surface-hover` block with `--radius-lg` (never truncated: the click approves it). Footer: Start secondary · Dismiss. After: "Started".
  - **Connect**: server 14/500 · scopes as tags (`--radius-tag`, 11.5, `--secondary-default`) · the leaves line 12.5 muted. Footer: Connect secondary · Skip ghost. After: "Connected".
  - **Change**: "{server} · {target}" header; one block per field: name 12.5 muted, before (strike, subtle) and after 14, `--background` block padding 10 12 `--radius-lg`; `long` fields show 6 lines then "Show all", which lets the same box scroll rather than grow, so the card keeps its height. Caption 12.5 muted italic-free under the fields. Footer: Apply primary · Dismiss ghost. After: "Applied · Open", or "Applied · Undo" for a change to What matters to you (SPEC 13.9).
  - **Remove** (only when Juno proposes it): rows: preview 13.5 ellipsis + time 12 muted; a checkbox row "Also remove Juno's reply" when offered; the line "Copies already sent to the model provider cannot be recalled." 12.5 muted. Footer: Remove ghost danger · Keep secondary. After: "Removed 2 messages".
  - **Budget**: "Juno has used today's budget." 14 · "$2.00 of $2.00 today" 12.5 muted tabular. Footer: Allow $1 more today secondary · Wait until tomorrow ghost. After: "Allowed until midnight".
  - **Provider**: "Choose a model provider" 14/500 · two option rows (36px, icon, label 13.5, note 12.5 muted) · the fixed disclosure 12.5 muted. Footer: Set up secondary. After: "Using Claude Sonnet 5.5".
- **Status bubble**: same row shape as a Juno bubble, with the mark. Bubble padding `10 14`, min-width 52: three 6px dots in `--foreground-muted`, each scaling 1 → 1.35 → 1 in turn over `--duration-pop` on a 1.2s loop (static at 0.6 opacity under reduced motion). When `text` is set the dots move left and the text follows at 13 subtle, cross-fading over 150ms on change. It has no Stop and takes no focus. Each Juno bubble takes its place when it arrives, and it shows again below while the run goes on (it is always the last row). The status text stays until the next bubble or the next tool's line.
- **Note**: centered row, 12.5 muted: "Remembered · Undo" (Undo as a text button while `undo`), "Removed", and the secret-blocked line. Padding 2 0.
- **Group label**: `--text-section-label` 11 muted, sentence case, margin-bottom 4, over the group's first bubble, gap 8: "Scheduled · Daily catch-up", "T3 Code · Fix the sidebar flake" or "T3 Code · 2 jobs" · "Why this?" · "Pause schedule" or "Mute updates" by origin, the last two as 11px text buttons subtle. "Why this?" opens a popover with the schedule or job and who set it up. Neither button stops a job.
- **Day separator** and **New divider**: as the topic view (§6): the day label `--text-divider` centered; the New divider with the count.
- **Header** (Juno tab): the topic header's islands and band (§5) over the chat, with the row capped at `--page-width` 720 and padding-inline 32 so the islands line up with the chat column. Left island: a title button (§5 look) with the Juno mark 18, "Juno" 14/600 and `caret-down` 12 muted, a menu button that opens Scheduled, What Juno remembers, Memory of this chat, Activity, Connections, Settings › Juno. There is no More button. Right island, only when `banner` is not `none`: the banner chip. Banner chips are 28px, `--radius-pill`, 12.5/500, `--secondary-default`, text from `chatCopy.banner[kind].chip` with `line` as the title: "Juno is paused · Resume" (Resume as a text button), "You're offline", "Juno restored from backup · Review", "Juno needs an update", "Juno is off", "Juno is on your other Mac". One chip at a time, by the precedence in `Banner`. AI off also ends the list with one line "Juno is off. Turn on AI assist in Settings." 13 muted centered, and the composer is disabled. The list's top inset, scroll padding and scrollbar track follow §5.
- **Composer**: outer padding `8 24 20` (panel `0 12 20`, so its field ends on the topic composer's line); box max-width 656 (the chat column's 720 less 32 each side, so it lines up with the bubbles and the header island), 40px at one line like the topic composer, bg surface, 1px `--input-border`, `--radius-composer` 20; textarea padding `9 0 9 14`, 14 lh 22, max-height `--assistant-input-max-height` 160; send button 28 round `ArrowUp` 16 bold (the topic composer's), margin 6, bg `--hl` fg `--hl-fg`, `--opacity-disabled` when empty. Placeholder 'Ask Juno, like "what did I miss in #eng?"'. Enter sends, Shift Enter newline; sending while a run is active queues (no disabled state). Disabled only for AI off, Update needed and Another device. The "New message" pill uses `chatCopy.list.newMessage`.
- **Context menu on a message** (native): Copy · React and Reply (Juno's bubbles and cards) · Remember this (owner messages only; disabled over 280 bytes without a selection) · Remove. Remove opens the **Remove sheet** (`RemoveSheet`): a native-style sheet with the title "Remove from Juno", the body line, the rows as on the Remove card, the "Also remove Juno's reply" checkbox when offered, the cannot-recall line, and Keep · Remove (danger). It needs no run, so it works paused, offline, in recovery and with AI off.
- **Elsewhere**: the sidebar's Juno nav item shows the unread count as the soft grey tag and the duotone sparkle while `busy`; the home's Ask Juno field shows `jobLine` in place of its placeholder as a text swap. ⌘J opens the tab and focuses the composer, except in a topic tab, where it toggles the panel (§12.1). Juno pages (Scheduled, What Juno remembers, Memory of this chat, Activity, Connections, and Review in recovery) use the §11 page shell: max-width 720, title serif 34, group cards `--radius-card` with rows divided by `--border-subtle`, rows min-height 48. Activity run outcomes print `chatCopy.pages.activity.outcome`; a failure row has "Copy details". Memory's masked lines read "being updated". A pin that changed under an edit reads "This changed. Check it and save again." Review lists the pending cards with "This may already have happened." and ends with "Activate Juno". Settings › Juno adds the ownership group (state, "Export recovery phrase", "Move to another Mac", "Restore from backup" with the attestation line), the rejected-key line, and "Removal pending · 1 copy in a running job · Stop job". The Connections T3 row adds the address field and the "Allow T3 Code over the local network" switch with its https note.

- [built WP14] The Juno tab is a page tab like Home, one tab for the one chat (`apps/desktop/src/renderer/containers/juno/`). The window is the agent's page of at most 200 rows: the tab opens on `unread`, the panel on `latest`, an edge slot near view moves the window by 100 rows around the first or last row, and a window that reaches the newest row follows it. Rows stay in flow, so scroll anchoring holds the rows in view. A Juno bubble fully on screen for a second in the focused window marks the chat read through it. The menu's Remember this and Remove, the note's Undo and the group label's actions wait for the agent's pins, removal and schedules, so they show disabled or do nothing; each Juno menu page, and Settings › Juno, opens in a tab of its own from the agent's served pages (`containers/juno/JunoPages.tsx`); Settings › Juno opens with `ProviderSection` from main's provider state, which works with no agent running; the rest of the page arrives from the agent once a provider runs it. On an OpenAI-compatible endpoint the model row lists its models, or is a Model id field when it lists none (`modelTyped`), and compaction uses the chat model. It edits the rules (WP15) and leaves out Codex, Backup and This Mac until their work packages are built. Home's Ask Juno opens the Juno tab and shows a running job's state line. Times: `juno.chat-send`, `juno.chat-bubble`, `juno.panel-open` (performance.md 1).

### 12.1 Juno panel

**Shows:** `docs/design/juno-panel/` (`panel-light.png`, `panel-dark.png`). SPEC §7 "Juno panel" decides behaviour.

- **Place**: the right side of a topic tab, below the tab strip, full height, `--juno-panel-width` 360. Background `--background`, left edge 1px `--border-default`. The topic (header, list, composer) takes the rest; its reading column re-centres in it. Under 480px left for the topic, the panel covers the workspace below the tab strip instead (same look, full width). No slide: it appears in one frame, so the topic reflows once.
- **Header**: the islands and band of §5 at the panel's width (row padding-inline 12, no width cap), on the same line as the topic's islands. Left island: the Juno title button (mark 18, "Juno" 14/600, `caret-down`), which opens the Juno menu (§12). Right island: **Open Juno tab** 28 round (`arrows-out-simple` 15, name "Open in a tab") · **Close** 28 round (`x` 15, name "Close Juno ⌘J"). A banner chip, when the chat has one, goes in the right island before these. No border-bottom. When the panel covers the topic, the topic's islands are hidden with it.
- **List**: the same chat (§12) in a narrower column, under the panel's islands: padding `16 16 12` below the `--header-inset`, bubbles max-width 85%, cards full column width. Opens at the bottom. Everything else (grouping, status bubble, cards, notes, separators) is unchanged.
- **About line**: above the first bubble of each owner group sent from the panel, right-aligned, 11.5 muted, margin-bottom 3, single line ellipsis: "About Postgres 16 migration plan" (Main: "About #eng · Main"). Shown in the Juno tab too. Clicking it opens the topic (⌘-click in a new tab).
- **Context above the composer**, stacked, gap 6, padding `0 12 6`:
  - **Selection**: when text is selected in the topic, a quote block (§6.3 look) of up to 3 lines with the sender's name 12/600, and a 20px `x` (name "Remove quote"). It follows the selection until you send or remove it.
  - **About chip** (from Ask Juno in a person's or channel's menu): 26px, `--radius-pill`, padding `0 4 0 9`, bg `--secondary-default`, 12.5/500, gap 6: avatar 16 or channel icon 12 muted · "About Maya Chen" / "About #eng" · 20×20 `x` (name "Remove"). While it shows, the message carries that person or channel instead of the topic, and no Catch me up pill shows. Sending keeps the chip until you remove it or close the panel.
  - **Catch me up** pill: 28px, `--radius-pill`, padding 0 12, bg `--secondary-default`, 12.5/500, shown when the topic opened at a "new" divider and nothing has been sent from the panel about it since. Click sends "Catch me up".
- **Composer**: the Juno composer (§12) with outer padding `0 12 12` and placeholder "Ask about this topic".
- **Keys**: ⌘J and the header's Juno button toggle the panel and focus its composer; Esc in an empty panel composer closes it and returns focus to the topic composer. Tab order: topic header → topic list → topic composer → panel header (Juno menu, Open in a tab, Close) → panel list → panel composer.
- **Saved**: whether the panel is open (one pref for all topic tabs).
- [built WP14] The panel is the `Workspace` view's `side` slot; the cover rule is a container query on the page row (840px = 360 + 480). The Juno button, ⌘J (View › Juno), Ask Juno and Home's field show unless AI assist is off (`junoAvailableAtom`). With no model provider set up the Juno tab and the panel show `NoProvider` ("Juno needs a model", Add a provider opens Settings › Juno) under the same header, with no composer. The selection is read from the visible topic's DOM on `selectionchange` and kept when it collapses; the messages on screen are read once, at send time. The open flag is the workspace pref `junoPanel`.

## 13. Notifications page

**Shows:** `docs/design/notifications/compare-light.png` (right column). SPEC 14 decides behaviour.

`Page width="settings"`: max-width `--page-width-settings` 760, the same column as Preferences and Settings › Juno, padding `40 32 72`, gap 36.

- Title "Notifications" serif 34; sub "During your notification hours, Juno lets through what needs you and holds the rest. Everything is in Juno whenever you open it." 14 lh 1.6 subtle max-width 620.
- Section pattern: heading 15/600, optional sub 13 muted (gap 2), then a group card (radius 10, bg surface, `--card-ring`, rows divided by 1px `--border-subtle`).

**Hours** (no sub)

- Two rows, min-height 60, padding `8 10 8 14`, gap 12: label block 260px (title 14/500, sub 12 muted) · flexible gap · seven day toggles (28px round, gap 4, 12/500; on: bg `--secondary-default`, fg default; off: transparent, muted; names "Monday"…) · from select · "to" 13 muted · to select. Selects 32px, radius 7, 1px `--input-border`, 13px, hours in half-hour steps ("9am", "6:30pm").
  - "Notifications" — sub "When it starts, one notification sums up what needed you." Once Slack's schedule is verified and written, the sub adds "Slack on your phone pauses too."
  - "Active in Slack" — sub "Outside these hours you show as away."
- Note row (border-top 1px `--border-subtle`, padding `10 14 12`, 12 muted): "Juno switches your status while it's open. If it's closed when your active hours start, you stay away until you open it."
- Defaults: both weekdays, 9am to 7pm. A to before from crosses midnight.

**What matters to you** — "Juno reads this for every message. You can also just tell Juno."

- Plain multi-line text field, margin-top 12, max-width 620, min-height 68, padding `10 12`, radius 8, 1px `--input-border`, bg `--background`, 14 lh 1.55. Placeholder "For example: the launch, hiring, and anything from my reports that needs a decision today." Saved on blur. With AI assist off, the field is replaced by "AI assist is off. DMs and mentions notify you." 13 muted.

**People and channels** (no sub)

- Two rows, padding `10 10 10 14`: label block 260px ("Every message" / sub "Even outside notification hours"; "Never" / sub "Still in Juno, no alerts") · tags right-aligned, wrapping, gap 6. Tag: 28px, padding `0 4 0 8`, radius 7, bg `--secondary-default`, 13/500, gap 5: channel icon 13 muted or avatar 16 · name · remove 20×20 `x` (name "Remove"). Removing sets the item back to When it matters, with an Undo toast.
- Both lists empty: one row "Every channel and person is set to When it matters." 13 muted, padding 14.
- Hint below the card, margin-top 8, 12 muted: "Right-click a channel or person to change how it notifies you."

**Today** (no sub)

- One line, margin-top 8, 14 subtle: "**4** messages interrupted you. Juno held **23**." (counts 600 tabular) · ghost button **Show why** 28px. Zero: "Nothing has interrupted you today."
- Show why expands a list under the line (rows padding `8 2`, divided by 1px `--border-subtle`, 13px): time 44px muted tabular · place 120px subtle · "**Sender** text" ellipsis; the reason on a second line, 12 muted. Only messages that notified are listed, newest first. The button becomes **Hide**.

[built M10] `NotificationsPage` in `@juno/views`, the Notifications tab (`bell`), opened from the avatar menu or Preferences. Hours selects are named "Notifications from", "Active in Slack to" and so on, and the day toggles are `DayToggles` in `@juno/ui` (Monday first). A change to the hours saves at once; What matters to you saves on blur. Removing a tag shows "#incidents: When it matters" with Undo. Show why opens a popover above the button (340px) with at most 50 messages, each as the time and place, the sender and text, and the reason, rather than expanding a list under the line: no interaction may move the page (the gallery's shift test), and the button keeps its label. Notification hours are not written to Slack's own schedule yet (docs/backlog.md), so the Notifications sub does not mention the phone.

**Decision** (`@juno/domain` `decideNotification`): ignored channel → Every message (channel or person) → Never → outside notification hours (into the summary if it would have notified) → AI assist off (DMs and mentions) → Juno's judgement. Reasons are the strings the why popover shows: "#incidents is set to Every message", "Maya Chen is set to Never", "Outside your notification hours. Juno: …", "AI assist is off, and DMs and mentions notify you", "Juno: asks you to approve the release before 2pm".

**Summary when notification hours start** (`hoursStartSummary`): one OS notification, "3 messages need you" / "In #eng, Maya Chen and #hiring" (three places, then "and N more"). None when nothing was kept for it. The same summary is a Juno message in the chat under the group label "Summary", one line per message ("Maya Chen in #eng: needs your approval before 2pm", the name and place as the source link); clicking the notification opens the Juno tab scrolled to it. With AI assist off, the click opens the first message.

## 14. Preferences

**Shows:** S13.

Page max-width 760, padding `40 40 72`, gap 36. Title "Preferences" serif 34.

- **Appearance** (first on the page, no sub). One group card, three rows, min-height 52, padding `8 10 8 14`, label 14/500 left, control right:
  - **Theme**: segmented control (padding 2, bg `--surface-hover`, radius 7; segments 26px, padding 0 10, 12.5/500, selected bg `--surface-raised` with `--shadow-sm`): System · Light · Dark. Default System. Changes apply in one frame (§18).
  - **Accent**: a row of 20px round swatches, gap 8, one per accent in tokens §1.3, each with a 2px ring in `--focus-ring` when selected and the accent's name as its accessible name and tooltip. Default Coral.
  - **Density**: segmented control: Comfortable · Compact. Default Comfortable (§3.3).
- **Peek key** — one row: "Hold to peek" 14/500 · segmented control: ⌥ Option · Space. Default ⌥ Option. [built M5] Saved as the workspace preference `peekKey`. `PeekKeySetting` lays the row out as Appearance's rows (label column, control beside it).

- **Ignored channels** — "Hidden from your topics, search and All topics, and they never notify you. Nothing changes in Slack." Group card: rows min-height 48, padding `8 10 8 14`: channel icon 15 muted · name 14/500 · "3 messages hidden" 12 muted · **Stop ignoring** 28px secondary 12.5/500. Empty row "Nothing ignored." 13 muted padding 14. Add row: "Ignore" 13 muted · select of non-ignored channels 32px · **Ignore** 32px secondary · right hint "You can also right-click a channel to ignore it" 12 muted. Ignoring shows the toast "Ignoring #deploys" with Undo. DMs cannot be ignored.
- **Notifications** — "Your hours, and what Juno lets through." Button **Open notification settings** 34px, padding 0 12, 1px `--border-strong`, radius 8, bg surface, `bell` 14, 13/500.
- [built M10] `PreferencesPage` in `@juno/views`: Appearance (Theme System · Light · Dark, Accent, Density) as one group card, Peek (Hold to peek: ⌥ Option or Space), and Notifications with its button. The ignore list is not on the page yet. Theme, accent and density are saved in main's `launch.json`, so the first frame of the next launch has them; System follows macOS and the window paints in the matching background.
- Nothing else from the prototype's design panel is a preference: row style, preview lines, avatars, grouping by channel, the quiet window and message style are gone for good. AI assist is the switch in the avatar menu (§2.1).

## 15. Context menus

Native menus **[spec]**. Prototype rendering for reference: 236px, padding 5, radius 13, `--pop-shadow`, z 40, positioned at the pointer and clamped 8px inside the window (246px from the right edge, 340px from the bottom); from the header's title button it is left-aligned 6px below the left island (§5). Items 30px, radius 6, padding 0 8, gap 10, 13px, icon 15 subtle, right hint 11 muted; separators 1px `--border-default` margin 4 6. Esc or outside click closes. Every item closes the menu.

**Shows:** S02, shot 22 (now opened from the header's title), shot 23 (tab), shot 32 (channel), shot 61 (dark).

### 15.1 Topic row / header title

| Item | Icon | Hint | Shown when | Effect |
| --- | --- | --- | --- | --- |
| Open in new tab | `square-arrow-out-up-right` | ⌘ click | always | |
| — | | | | |
| Rename | `pencil` | | not Main | inline rename in the row (or in the header's title island when opened from there) |
| Redraw | `paintbrush` | | AI assist on, not a DM's Main | `art.redraw`: a new drawing of the topic's art (a few seconds), then the toast with Undo, which puts the old drawing back. "Could not redraw · …" (no Undo) when the model gives nothing |
| Mark as read / Mark as unread | `check-check` / `circle-dot` | | by state | unread sets count to at least 1 |
| Pin / Unpin | `pin` / `pin-off` | | by state | |
| Resolve / Reopen | `circle-check` / `rotate-ccw` | | by state | undo toast; resolve clears unread and mention |
| — | | | | |
| Copy Slack link | `link` | | always | |
| Open in Slack | `arrow-square-out` | | always | opens the Slack app at the topic (`slack://` deep link, falling back to the web permalink) |
| Notify me | `bell` | current level | always | submenu §15.3: for a thread, the thread's own choice (Every message and When it matters follow it in Slack, Never unfollows it; SPEC §5); for Main, the channel's or DM's. [built M10] Through `notifications.setLevel`: on a thread the engine follows or unfollows it and keeps Every message as its level; on Main it sets the channel's or DM's level |
| Add to view | `stack` | | Main only | submenu §15.8 for the row's channel or DM |
| Ignore #product | `ban` | | channel is not a DM | toast "Ignoring #product" with Undo |

[built] The row and the header's title show this menu, and every item works (M5). Rename from the row edits the row's title (§3.2), from the header the header's title (§5). Each action shows its toast with Undo (§16). The hints are not drawn, since a native menu has only a shortcut column.

### 15.2 Channel menu (context pill, #channel chip, ⌘K channel result)

| Item | Icon | Hint | Shown when |
| --- | --- | --- | --- |
| Show its topics | `list-filter` | | always |
| Open Main | `message-square` | | Main exists |
| — | | | |
| Mark channel as read | `check-check` | | always (clears unread on every topic in it) |
| Mark channel as unread | `circle-dot` | | always (marks the latest topic unread) |
| — | | | |
| Notify me | `bell` | | always (submenu §15.3) |
| Add to view | `stack` | | always (submenu §15.8) |
| Ignore channel | `ban` | Hide in Juno | not DM |
| — | | | |
| Ask Juno | `sparkle` | | AI assist on (opens the Juno panel with an "About #eng" chip, §12.1) |

[built WP14] Right-clicking the header's context pill or a #channel chip shows this menu, with Notify me set from the channel's level. Mark channel as read and as unread show disabled until the engine has a channel-wide read command.

### 15.3 Notify me submenu

Shown from 15.1 (also opened from the header's title, §5), 15.2 and 15.6. Three items with a checkmark (13, `--foreground-default`) on the current one: **Every message**, **When it matters** (default), **Never**. For a person the parent reads "Notify me about Maya". Choosing one applies at once with the toast "#design-review: Never" and Undo.

### 15.4 Message menu

Right-click on a message, and the message's More menu (the why item is new; the others wait for M6): Copy text (`copy`), Reply in thread (`message-square-reply`, Main only), separator, **Why did this notify?** / **Why no notification?** (`circle-help`, by what happened; hidden for your own messages), **Tell me if nobody replies** (`alarm`, your own messages only, AI assist on). The last one creates the reply watch at once, with no Juno run: a reply from anyone but you counts, and the wait ends at the same time on your next notification day, or at the start of notification hours if that time is outside them. It shows the toast "Watching for a reply until Thu 9:00 · Undo" (Undo deletes the watch) and adds a Schedule card to the Juno chat; nothing opens. Disabled while Juno is paused or on another Mac (SPEC 13.6).

[built M5] Right-click (or the context-menu key on a focused message) shows Copy Slack link and Open in Slack. A reply's link carries `?thread_ts=&cid=`, as Slack's own links do; Open in Slack opens the channel, as on the tab menu. The other items come with their features. [built M6b] The toolbar's More shows the same menu. Your own messages start it with Edit and Delete; Main adds Reply in thread; a message Slack does not have yet has Copy Slack link disabled.

The why popover anchors under the item: 300px, padding `14 16`, radius 13, bg surface, `--pop-shadow`, gap 6. Title 13/600 ("Notified you at 13:42", "Didn't notify you", "In the 9am summary") · reason 13 subtle lh 1.5 (the decision's reason) · one button right-aligned, 28px secondary: **Change** when the reason is a setting (opens §15.3 for that channel or person, or the Notifications page for hours), **Tell Juno** when it was Juno's call (opens the Juno chat with the message quoted in the composer). Esc or outside click closes.

[built M10] The why item follows Open in Slack after a separator, on others' messages; its label comes from the engine's answer (`notifications.why`), asked before the menu opens. The popover (`WhyPopover`) opens where the menu did. Change opens the three choices as a native menu at the same place (no Notify me parent), or the Notifications page for the hours. Tell Juno is not shown until the Juno chat exists. A message the engine never decided (not a DM, a mention or an Every message place) reads "Didn't notify you" with "Juno checks DMs, mentions of you, and places set to Every message. This was none of them." and Change for its channel, unless a Never level or an ignored channel explains it.

### 15.5 Tab menu

Right-click any tab (§4). Pin tab / Unpin tab (`push-pin`) · — · Close tab (⌘W) · Close other tabs · Close tabs to the right (disabled on the last tab) · Close all tabs · — · Copy Slack link · Open in Slack (topic tabs only). The close items leave pinned tabs open, except Close tab on a pinned tab itself.

### 15.6 Person menu

Right-click a sender's name or avatar in a message, or an @person chip. Notify me about Maya (`bell`, submenu §15.3) · — · Ask Juno (`sparkle`, AI assist on; opens the Juno panel with an "About Maya Chen" chip, §12.1).

[built M10, WP14] On a sender's name or avatar (`data-sender` in `Message`), not on your own, and on an @person chip: Notify me about Maya, then Ask Juno while the Juno Agent runs (`notifyActions.showPersonMenu`).

### 15.7 View pill menu

Right-click a view's pill (§2.3). Edit view… (opens the view sheet) · Move left (disabled on the first view) · Move right (disabled on the last) · — · Delete view. Delete shows the toast "Deleted view · Bots" with Undo, which puts the view back with its conversations, icon, switch and place. All, Channels, DMs and New view have no menu.

### 15.8 Add to view submenu

Shown from 15.1 (Main rows) and 15.2. One item per view, in pill order, with a check on the views that hold the conversation; choosing an unchecked view adds it ("Added #alerts-prod to Bots"), a checked one removes it ("Removed #alerts-prod from Bots"), each with Undo. Then a separator and **New view…**, which opens the sheet with the conversation already chosen. With no views, the submenu holds New view… alone.

## 16. Toasts

**Shows:** shot 18-toast-undo.

- Position: bottom-left, left 16, bottom 16, z 45, max-width 352. Padding `8 8 8 14`, radius 10, bg `--foreground-default`, text `--background`, `--shadow-lg`, 13px, gap 12. Text ellipsis on one line.
- Undo button (reversible actions only): 26px, padding 0 8, radius 6, bg `color-mix(var(--background) 16%, transparent)`, "Undo" 12.5/600 + "⌘Z" mono 11 at .75 opacity.
- One toast at a time; a new one replaces the old. Auto-dismiss 5s (with Undo) or 4s (info). No enter/exit animation in the prototype; [proposed] 150ms fade is acceptable.
- Undo stack holds 20 actions; ⌘Z pops the last one (resolve, reopen, pin, unpin, rename, redraw, mark read or unread, Notify me change, ignore, routed post, command send, Resolve all on Home, delete view, add to or remove from a view) when focus is not in a non-empty input.
- [built M5] `ActionToast` in `@juno/views`, mounted once by the shell over both panes, with the `Toast` rise. The undo stack and the toast are `undoStackAtom` and `toastAtom` in `@juno/state`; an action that changed nothing shows no toast. No exit fade yet.

| Copy | Undo |
| --- | --- |
| Resolved · Postgres 16 migration plan | yes |
| Resolved · #eng (Main rows use the channel label) | yes |
| Reopened · … / "{topic or channel}: Never" (and the other Notify me choices) | yes |
| Ignoring #deploys | yes |
| Pinned · … / Unpinned · … | yes |
| Marked as read · … / Marked as unread · … | yes |
| Renamed · {new title} / Title cleared | yes |
| Redrawn · … | yes |
| Could not redraw · … | no |
| Posted in Staging bill doubled since August · Posted in #eng · Main | yes |
| Resolved 3 topics (Home's Tidy up) | yes |
| Draft closed (a New chat closed with a draft) | yes |
| Follow-up done | no |
| Deleted view · Bots | yes |
| Added #alerts-prod to Bots / Removed #alerts-prod from Bots | yes |

## 17. Empty states

| Where | Copy | Style | Shows |
| --- | --- | --- | --- |
| Workspace, no tabs | Home (§11) | | `docs/design/home/` |
| New chat, no destination | "Write your message, then pick where it goes." | 14 muted, centred | §8 |
| Sidebar list | see §2.6 | | shot 48 |
| All topics table | "No topics match these filters." | 13 muted, padding 48 | shot 40c |
| Juno | "What do you need?" + suggestions | §12 | S11 |
| ⌘K | "No matches." | 13 muted, padding 20 10 | |
| New chat pickers | "No match." | 13 muted | |
| Ignored list | "Nothing ignored." | 13 muted | |
| Thread with no replies (thread link) | "Thread" instead of "N replies" | | |

[spec] Empty states say why and offer one next step; All topics and ⌘K empties in the prototype have no action. [built] the All topics empty state has "Clear filters".

## 18. Dark mode

**Shows:** S15, shots 60–65.

- Trigger: Theme in Preferences › Appearance (§14): System (the default, follows macOS), Light or Dark. There is no title bar button. Root gets `data-theme="dark"` and the dark token block (tokens §1.2) applies; nothing else changes.
- During the switch the root carries `data-theme-switching` for two frames so every transition is disabled and colours change at once.
- Dark-only values: the dark base palette (tokens §1.2), the dark shadows, `--tint-resolved-fg` at 52%, the avatar mixes 32% / 46%; the other tints and `--hl-soft` recompute from the dark base. Every accent has its own dark values (tokens §1.3): ink flips to light (#EDEADE) with near-black text, Coral goes from #CC4628 to #FF8A73.
- Everything else (sizes, weights, icons) is identical. Check: resolved chip text in dark is 5.94:1; cyan takes near-black text on its fill (tokens §1.3).

## 19. Preferences that change the look

Stored as user preferences. Nothing else from the prototype's design panel (`data-props`) survives: `rowStyle`, `showAvatars`, `grouping`, `quietDays` and `messageStyle` are removed, with their variants.

| Preference | Options | Default | Affects |
| --- | --- | --- | --- |
| theme | system, light, dark | system | §18 |
| accent | the accents in tokens §1.3 | coral | `--hl` and its group |
| density | comfortable, compact | comfortable | §3.3, §6.1 |
| aiAssist (avatar menu) | on, off | on | Hides: settled hint, send checks, audience warning, Home's follow-up and tidy-up items and AI title lines, the Juno panel and its button, topic art; ⌘K still searches. [spec] also turns off notification gating and Juno |
| sidebarWidth, sidebarCollapsed | 280–480px; on, off | 384, off | §1; kept in main's `launch.json` with the theme, so the first frame has them |
| junoPanelOpen | on, off | off | §12.1 |

## 20. Keyboard map

| Keys | Where | Action |
| --- | --- | --- |
| ⌘K | anywhere | Toggle palette |
| ⌘J | topic tab | Toggle the Juno panel and focus its composer |
| ⌘J | elsewhere | Open Juno tab and focus its input |
| ⌘N, ⌘T | anywhere | New chat in a new tab |
| ⌘W / ⌘⇧T | anywhere | Close tab / reopen the last closed tab |
| ⌘1–⌘8, ⌘9 | anywhere | Go to that tab / the last tab |
| ⌃Tab, ⌃⇧Tab, ⌘⇧], ⌘⇧[ | anywhere | Next / previous tab |
| ⌘[ / ⌘] | anywhere (not while a text field has a selection to indent; none do in v1) | Back / forward in the tab's history |
| ⌃⌘S | anywhere | Hide or show the sidebar |
| ⌘Z | anywhere, unless focus is in a non-empty input | Undo last reversible action |
| ⌘, | anywhere | Preferences (shown in the avatar menu; [proposed]) |
| Esc | anywhere | Close palette, picker, menus, popovers; dismiss send check; cancel rename; close the Juno panel from its empty composer |
| Enter / Space | any `role="button"` (tabs, menu items, palette rows, Juno topic links) and the sidebar rows | Activate |
| ⌘ click / ⌘ Enter | rows, tabs, links, palette, cards' Open topic | Open in a new tab |
| Enter / Shift Enter | composer, Juno input | Send / newline |
| Enter / Esc | while a send check is shown | First option / back to editing |
| ↑ ↓, Enter or Tab, Esc | @ and # suggestions | Move, insert, close |
| ↑ ↓, Enter, ⌘Enter, Esc | palette | Move, open, open in new tab, close |
| ↑ ↓, Enter, Esc | New chat pickers | Move, pick, close |
| Enter / Esc / blur | rename | Save / cancel / save |
| Context-menu key, right-click | rows, tabs, context pill, All topics rows | Menu |
| Tab order | sidebar bar (collapse, back, forward, search, new chat, avatar) → nav → filters → rows → tab strip → header (context pill, title, Resolve or Threads, Juno) → messages → composer → Juno panel | Hover-only actions (row Resolve, message toolbar) appear on focus |

## 21. Shared copy

- Relative time: "now", "4m", "2h", "Yesterday", "3d" (under 14 days), then "2w". Prototype formula; SPEC lists "4m, 2h, Yesterday, 3d".
- Message times: "9:12", "Yesterday", "Sat", "Oct 3".
- Channel kinds: "Public channel", "Private channel", "Direct message", "Group DM".
- Main labels: "#eng · Main", "Maya Chen · Main"; tab shows "eng"; row shows "#eng" + Main tag; header sub "Messages posted outside threads".
- "#" is never repeated next to a hash icon (pills, tabs, row line 3, table Where column).
- Never emoji in chrome; reactions and user text are the user's own.
