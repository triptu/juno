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

- Two panes: sidebar 384px fixed left; workspace fills the rest. Root is `display: flex; height: 100%; overflow: hidden`.
- Root text: 14px, line-height 1.5, letter-spacing 0.01em, `--font-sans`, colour `--foreground-default`, background `--background`.
- Sidebar top bar: 44px, padding `0 10px 0 16px`, background `--background-subtle`. Traffic lights live here (Electron `titleBarStyle: 'hiddenInset'`; the prototype fakes them as 12px circles with 6px gaps). The bar is a drag region (`-webkit-app-region: drag`), buttons inside are `no-drag`.
- Workspace top bar: the tab strip, 44px, also a drag region. Border-bottom 1px `--border-default`, background `--background-subtle`.
- Sidebar right edge: 1px `--border-default`.
- Scrollbars: 10px, transparent track, thumb `--border-strong` with 3px transparent inset and radius 10 (`::-webkit-scrollbar`). Scroll containers use `overscroll-behavior: contain` so menus, popovers and the palette never scroll the page behind.

## 2. Sidebar

**Shows:** S01 (whole sidebar), S02 (row context menu), shot 30-avatar-menu, shot 31-browse-channels, shot 33-scope-chip.

### 2.1 Title bar icons

Right-aligned group, gap 2px, inside the 44px bar.

| Button | Icon | Size | Accessible name | Action |
| --- | --- | --- | --- | --- |
| Search | `search` 16 | 30×30, radius 8 | "Search ⌘K" | Opens ⌘K palette |
| Browse | `hash` 16 | 30×30 | "Browse channels and people" | Toggles the Browse popover; background `--secondary-default` while open |
| Theme | `moon` / `sun` 16 | 30×30 | "Toggle theme" | Switches light/dark in one frame |
| New | `square-pen` 16 | 30×30 | "New message" **[spec]** (prototype says "New topic") | Opens the New message page |
| Me | avatar 24 | 30×30 round, margin-left 4 | "Account and preferences" | Toggles the avatar menu |

Style: transparent, colour `--foreground-subtle`, hover `--surface-hover`, press scale .96.

**Avatar menu** (popover, 248px wide, anchored top 36px right 0, z 20, padding 6, radius 13, `--pop-shadow`):

- Header: avatar 32 + "Tushar" 13/600 + "acme.slack.com" 12 muted; padding `8 8 10`.
- Separator 1px `--border-default`, margin `2 6 4`.
- Items 32px, radius 6, padding 0 8, gap 10, icon 15 `--foreground-subtle`, label 13, right hint 11 muted:
  - Set status (`circle-dot`)
  - Notifications (`bell`) — hint "Next digest 3pm" (next digest time; "Next digest tomorrow 10am" after the last one)
  - Preferences (`settings`) — hint "⌘,"
  - AI assist (`sparkles`) — [proposed] right side is a switch; prototype shows nothing
  - separator
  - Switch workspace (`arrow-left-right`)
  - Sign out (`log-out`)
- Closes on Esc, outside click, or picking an item.

**Browse popover** (300px, top 36 right 0, z 20, radius 13, `--pop-shadow`, overflow hidden):

- Search header: `search` 14 muted + input 13px, placeholder "Find a channel or person"; padding `10 12`; border-bottom 1px `--border-default`. Autofocused on open. Enter picks the first match.
- List: max-height 400, padding 6, contained scroll. Rows 32px, radius 6, padding 0 8, gap 10, 13px:
  - First row "All topics" with `inbox` icon and total unread count tag; selected (background `--secondary-default`) when not scoped.
  - Channels and DMs sorted by latest activity; ignored channels excluded. Leading `hash`/`lock` icon 15 muted, or 18px avatar for DMs (group DMs show two initials). Name 13, weight 600 when it has unread. Meta 11 muted: "private" or "quiet" (no activity in the quiet window). Trailing count tag 18px (unread count; or "@" with `--hl` background and `--hl-fg` text when a topic there mentions you). Selected row = current scope.
  - Empty: "No match." 13 muted, padding 14 8.
- Footer: "Right-click a channel to mark it read or unread", 11 muted, padding 8 14, border-top 1px `--border-subtle`.
- Click a row → scope the sidebar to that channel (chip appears), popover closes. Right-click → channel context menu (§15.3).

### 2.2 Navigation

Container padding `4 10 0`, gap 2. Three full-width buttons, 32px, radius 7, padding 0 10, gap 10, 13/500, icon 15 `--foreground-subtle`:

| Label | Icon | Trailing | Active when |
| --- | --- | --- | --- |
| All topics | `layout-list` | none | All topics tab is active (background `--secondary-default`) |
| For you | `lightbulb` | count tag: 18px, min-width 18, radius 6, 11/500, bg `--secondary-active`, fg subtle, tabular; hidden at zero | For you tab active |
| Juno | `sparkles` | "⌘J" mono 11 muted | Juno tab active |

Hover `--surface-hover`. ⌘-click opens in a new tab.

Hairline below: 1px `--border-default`, margin `12 16 10`.

### 2.3 Quick filters

Row padding `0 10 10`, gap 2. Buttons 28px, radius 7, padding 0 10, 13px.

- Left: **All · Channels · DMs** (segmented by state, not a visible control). Selected: weight 600, bg `--secondary-default`, fg default. Unselected: weight 500, transparent, fg muted; hover fg default. A 5px dot in `--hl` after "Channels" or "DMs" when that group has unread subscribed topics and the group is not selected. DMs include group DMs. Picking Channels/DMs clears a scope of the other kind.
- Right: **Unread** toggle, weight 500. On: bg `--secondary-default`, fg default. No count, no dot. Accessible name "Show unread only".

### 2.4 Scope chip

Only when scoped to one channel. Row padding `0 16 8`. Chip 26px, radius 6, bg `--secondary-default`, padding `0 4 0 9`, gap 6, 12.5/500: channel icon 12 muted, name without "#", then a 20×20 close button (`x` 11, radius 4, hover `--secondary-hover`), accessible name "Show everything". Scoping sources: Browse row, "Show its topics" in a channel menu, clicking a #channel chip in a message, ⌘K "show its topics" result.

### 2.5 Topic list

Scroll container, padding `0 8 16`, contained scroll.

- Sections: **Pinned** then **Recent**. Section label 10.5/500 uppercase 0.06em muted, padding `14 12 6`. "Recent" label only shows when a Pinned section exists.
- Sort: latest activity first within each section.
- **Group by channel (tweak `grouping: channel`)**: Pinned stays first; the rest is split into one section per channel in order of latest activity, labelled with the channel label ("#eng", "Maya Chen", "#alerts-prod"), same label style. Only applies when not scoped. Shot 55-group-by-channel.
- Row gap: chat 2px, list 0, cards 6px.
- Visibility rules (SPEC §5): hide when quiet (no activity for `quietDays`, default 7, and no unread), resolved, unsubscribed (unless it mentions you), or in an ignored channel. Pinned rows are always shown. Mark-as-unread brings a quiet row back.
- Prototype difference: a pinned row that is resolved stays visible with a green `circle-check` 14 before its title and no hover Resolve button. **[spec]** says resolving hides the row; decision needed (see summary).

### 2.6 Sidebar empty state

Centered, padding `48 16`, gap 8: title 14/500, body 13 muted lh 1.5, button 30px radius 7 `--secondary-default` 13/500 (margin-top 4).

| Condition | Title | Body | Button |
| --- | --- | --- | --- |
| Unread filter on, nothing unread | No unread topics | Your filters are hiding everything. Older and resolved topics are in All topics. | Clear filters |
| Channels/DMs filter or scope hides everything | No recent topics here | same | Clear filters |
| No filters, nothing recent | No recent topics here | Topics with activity in the last 7 days show up here. | View all topics |

## 3. Topic row

**Shows:** S01 (unread, mention, Main tag, selected), S02 (context menu), S14 (selected + mention), shot 02-row-hover-resolve, shot 20-rename-row, shots 50–54 (styles, densities, no avatars).

### 3.1 Anatomy (chat style, balanced density, default)

```
[tile 44]  [line 1: title ........................ time | Resolve]  height 22
           [line 2: Sender: preview, 2 lines .....  @ | count ]
           [line 3: ⌗ channel   ○○○   ▢ 7   ]              margin-top 3
```

- Container: `role="button" tabindex="0"`, flex, gap 12, align start, padding `11 12`, radius 10, transparent. Hover `--surface-hover`. Selected (open in the active tab) `--secondary-default`.
- Tile (chat style only): 44×44 (36 compact). Channel: first letter uppercase, 14/600, bg `--secondary-default`, fg subtle, radius 10. DM: person avatar, round, person colours (tokens §1.6). Group DM: first initials of each member ("ML").
- Line 1 (22px box, gap 6): title 14.5px (13.5 compact), weight 500 (600 unread), letter-spacing 0, single line ellipsis, `flex: 0 1 auto` so tags stay visible. Then optional tags in order: **Main**, **Reopened**, unsubscribed `bell-off` 13 muted. Spacer. Then time 12px tabular, muted (subtle when unread).
  - Main tag: 18px, padding 0 6, radius 6, 1px `--border-strong`, 11/500 subtle, title "Messages posted in this channel or DM outside any thread".
  - Reopened tag: same but filled `--secondary-default`, no border, title "New activity after it was resolved".
- Line 2 (gap 8): preview 13px lh 1.45, muted (subtle when unread), `-webkit-line-clamp` 1 or 2 (tweak `previewLines`, default 2), `text-wrap: pretty`. Text is "Sender: text" with "You:" for own messages and ">" quote lines stripped. Right column (gap 4, padding-top 1):
  - **@ tag** when the latest unread run mentions you: 18px, min-width 18, radius 6, bg `--hl-soft`, inset 1px ring `--border-strong`, "@" 11/500 subtle, title "Mentions you".
  - **count tag** = unread count: 18px, min-width 18, padding 0 5, radius 6, 11/500 tabular; unread row bg `--secondary-active` fg subtle; otherwise `--secondary-default` fg muted. Hidden at 0.
- Line 3 (12px muted, gap 12, margin-top 3): channel icon 12 + name (no "#"); for Main rows the icon is `messages-square` and the text is "Messages outside threads" (prototype) — **[spec]** line 3 should be the channel icon and name; see open questions. Then the avatar stack (18px circles, −4 overlap, 1.5px `--background-subtle` ring, initials 7.5/600, up to 4 participants) — in the prototype it shows only in list and cards styles and only when `showAvatars` is on; **[spec]** lists it as part of every row. Then `message-square` 12 + total message count.
- Title text: manual title, else AI title, else first ~6 words of the first message with "…". Main rows show the channel label ("#eng", "Maya Chen").

### 3.2 States

| State | Change |
| --- | --- |
| Read | Title 500, preview muted, time muted, no count tag |
| Unread | Title 600, preview subtle, time subtle, count tag `--secondary-active` |
| Mention | @ tag before the count tag (count may be absent) |
| Hover (pointer) / focus-within | Time hidden; **Resolve** button in its place: 22px, padding 0 8, margin-right −4, 1px `--border-strong`, radius 6, bg `--surface-default`, `check` 12 + "Resolve" 11.5/500, hover border `--border-strongest`, title "Resolve and hide until there is new activity". Not shown on resolved rows or while renaming |
| Focused (keyboard) | 2px focus ring; Resolve button visible; Enter/Space opens |
| Selected | bg `--secondary-default`; stays while hovered |
| Main | Main tag after the title; title is the channel label |
| Reopened | Reopened tag; row is back after a resolve |
| Unsubscribed (shown because it mentions you) | opacity .6, `bell-off` icon |
| Resolved (pinned only) | green `circle-check` 14 before the title, no Resolve on hover |
| Renaming | Title replaced by input: 24px, margin −2 0, padding 0 6, 1px `--border-strongest`, radius 6, bg surface, 14/600; text preselected; Enter saves, Esc cancels, blur saves. Row click disabled |

### 3.3 Row style tweak (`rowStyle`)

| Style | Tile | Padding | Radius | Border | Background | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| chat (default) | yes | 11 12 | 10 | none | transparent | 2 |
| list | no | 11 12 | 0 | bottom 1px `--border-subtle` | transparent | 0 |
| cards | no | 13 14 | 10 | 1px `--border-default` all round | `--surface-default` | 6 |

List and cards show the avatar stack in line 3 instead of the tile. Shots 50, 51.

### 3.4 Density tweak (`density`)

| Density | Vertical padding | Line gap | Title | Tile | Row height (1 / 2 preview lines) |
| --- | --- | --- | --- | --- | --- |
| compact | 8 | 1 | 13.5 | 36 | 80 / 99 |
| balanced | 11 | 3 | 14.5 | 44 | 90 / 109 |
| airy | 15 | 5 | 14.5 | 44 | 102 / 121 |

Density also changes the message list (§6.1).

### 3.5 Interactions

- Click: open in the current tab. ⌘-click: new tab. If already open in a tab, that tab is focused.
- Right-click / context-menu key: row context menu (§15.1).
- Hover Resolve: resolves, marks read, hides the row, toast "Resolved · {title}" with Undo. Main rows resolve the same way (toast uses the channel label).

## 4. Tabs

**Shows:** S01 (two tabs), S08 (three tabs with page tab), S14 (stealth tab), shot 23-tab-context-menu.

- Strip: 44px, align-items flex-end, padding 0 10, gap 2, overflow hidden.
- Tab: `flex: 0 1 230px`, min-width 72, height 35, margin-bottom −1, padding `0 6 0 12`, radius `8 8 0 0`, 1px border, 13px, gap 8.
  - Active: bg `--background`, border `--border-default` with bottom border in `--background` so it merges into the page; fg default; weight 500.
  - Inactive: transparent, border transparent, fg subtle, weight 400; hover fg default.
  - Icon 14 at 0.75 opacity: channel kind icon for topics (`hash`/`lock`/`user`/`users`), `eye-off` when stealth, `layout-list` All topics, `lightbulb` For you, `sparkles` Juno, `square-pen` New message, `bell` Notifications, `settings` Preferences.
  - Label: topic title, channel name for Main (no "#"), or the page name. Ellipsis.
  - Close: 20×20, radius 4, `x` 12 muted, hover bg `--secondary-default`, accessible name "Close tab". Always visible (prototype); [proposed] keep always visible, it is the macOS Safari pattern too.
- New tab button after the last tab: 28×28, radius 8, `plus` 15 muted, margin `0 0 4 4`, opens New message (prototype title "New topic"; use "New message").
- Behaviour: everything opens in the current tab; ⌘-click or "Open in new tab" adds one. Pages (All topics, For you, Juno, Notifications, Preferences, New message) are singletons: opening again focuses the existing tab. Closing a tab focuses the tab now at the same index (the right neighbour), else the last one. With no tabs the workspace shows the empty state (§17).
- Stealth tab: opened via "Open in stealth"; icon `eye-off`; unread stays; header shows the stealth pill (§5). Sending a reply or "Mark read" ends stealth.
- Right-click on a topic tab: the row context menu for that topic. Page tabs have no menu.
- Keyboard: tabs are `role="button" tabindex="0"`; Enter/Space activates. [proposed] ⌘W closes the active tab, ⌘⇧[ / ⌘⇧] switch tabs (not in prototype).

## 5. Topic header

**Shows:** S01 (public, AI sparkle), S04 (Main header), S14 (private + stealth), shot 21-rename-header, shot 22-header-more-menu, S15 (dark, pinned state on Pin button).

Container: padding `14 24 14 32`, border-bottom 1px `--border-subtle`, two rows with gap 8. Height 95px.

Row 1 (gap 8):

- **Context pill**: 26px, radius 6, padding 0 10, gap 6, 12.5/600; icon 13; text "{channel} · {kind}" where the kind is 400 weight. Title attribute = kind.

  | Kind | Icon | Text | Colours |
  | --- | --- | --- | --- |
  | Public channel | `hash` | "eng · Public channel" | `--tint-public` |
  | Private channel | `lock` | "hiring · Private channel" | `--tint-private` (amber) |
  | Direct message | `user` | "Maya Chen · Direct message" | `--tint-dm` (blue) |
  | Group DM | `users` | "Maya, Leo · Group DM" | `--tint-dm` |

- **Stealth pill** (only in stealth): 26px, radius 6, 1px dashed `--border-strongest`, padding `0 4 0 10`, fg subtle 12px, `eye-off` 13, text "Stealth. Not marking as read.", then button "Mark read" 20px, padding 0 8, radius 4, bg `--secondary-default`, 11.5/500.
- Spacer.
- **Pin** icon button 32×32 radius 8 (`pin` 16, subtle). Pinned: bg `--secondary-default`. Name "Pin" / "Unpin".
- **Subscribe** icon button 32 (`bell` subscribed / `bell-off` unsubscribed). Name "Subscribed. Click to unsubscribe." / "Unsubscribed. Click to subscribe." Toggling shows an undo toast.
- **Resolve / Reopen**: 32px, padding 0 12, margin-left 4, 1px `--border-strong`, radius 8, transparent, 13/500, icon 14 (`circle-check` / `rotate-ccw`), hover `--surface-hover`. Undo toast.
- **More** icon button 32 (`ellipsis` 16). Opens the row context menu anchored under the button, right-aligned (+4px).

Row 2 (gap 8):

- Title 20/600, letter-spacing −0.01em, lh 1.3, single line ellipsis. Double-click to rename (title attribute "Double-click to rename"; not on Main).
- AI sparkle `sparkles` 14 muted after the title when the title is AI-generated and no manual title exists (title attribute "Title suggested by AI. Double-click to rename."). Hidden when AI assist is off.
- Main header: title "#eng · Main" (DM: "Maya Chen · Main") followed by "Messages posted outside threads" 13 muted. No sparkle.
- Rename input: 34px, margin `−3 0 −3 −8`, padding 0 8, 1px `--border-strongest`, radius 8, bg surface, 20/600 −0.01em; preselected. Enter saves, Esc cancels, blur saves. Saving an empty title, or the same text as the AI title, clears the manual title.

## 6. Message list

**Shows:** S01 (flat, grouping, new divider, catch-up, quote, mentions, reaction), S04 (grouping suggestion, thread link), S14 (mention tint), S15 (dark), shot 07, 08 (hover toolbar, picker), shot 15 (selection quote), shot 19 (settled hint), shot 56/56b (bubbles).

Scroll container `[data-scroll]` with contained scroll; inner column max-width 800, centered, padding `20 24 16`.

### 6.1 Flat messages (default)

- Message: flex, gap 12 (0 when avatars off), padding by density (compact `2 8`, balanced `4 8`, airy `6 10`), radius 8, `tabindex="0"`. Hover bg `--background-subtle`. Mentions you: bg `--hl-soft` permanently.
- Grouping: consecutive messages by the same sender share one header. First of a group has margin-top 6/12/18 (density) unless it is the first message or sits right after the "new" divider. A quoted message always starts a new header.
- Avatar column 32px (0 when off). Avatar 32 round, margin-top 2, initials 12/600, shown on the first message of a group.
- Header: name 14/600, time 12 muted, gap 8, baseline aligned.
- Body: 13.5/14/14.5 by density, lh 1.6, `overflow-wrap: anywhere`, `white-space: pre-wrap`, `text-wrap: pretty`; blocks stacked with gap 2. Selectable.
- Timestamps: "9:12" (same day), "Yesterday", weekday "Sat", "Oct 3".

### 6.2 Inline chips

- **@person**: weight 600, padding 0 3, radius 4, bg `--hl-soft`, fg default. **@you**: bg `--hl`, fg `--hl-fg`. In your own bubble: `color-mix(currentColor 16%, transparent)`.
- **#channel**: same look as @person; clicking scopes the sidebar to that channel (stops propagation).
- Tokens are matched against known names ("@Maya Chen", "@Maya", "#eng"); longest first.

### 6.3 Quote block

Lines starting with ">" render as one block: margin 2 0, padding 4 10, radius 6, bg `color-mix(currentColor 6%, transparent)` (12% inside bubbles), colour `--foreground-subtle` (inherit inside own bubble), pre-wrap. Consecutive quote lines merge; empty text blocks are dropped. S01 shows one.

### 6.4 Reactions

Under the body, flex-wrap, gap 4, margin-top 6. Chip 24px, padding 0 8, gap 5, radius 6, 12px, emoji + count 500. Border 1px `--border-default`; mine: border `color-mix(var(--hl) 45%, transparent)` and bg `--hl-soft`. Hover border `--border-strongest`. Click toggles mine; a chip with zero reactors disappears.

### 6.5 Hover toolbar

Appears on hover or focus of a message: absolute, top −14, right 8, z 2, padding 2, gap 2, radius 9, bg `--surface-default`, `--pop-shadow`. Measured 191×34.

Contents: three quick reactions 👍 ✅ 👀 (28×28, radius 6, emoji 15px, name "React 👍") · 1px separator (`--border-default`, margin 4 2) · **More reactions** (`smile-plus` 16) · **Quote** (`quote` 16) · **Reply in thread** (`message-square-reply` 16, Main threads only). Hover bg `--surface-hover`.

Picker: clicking More replaces the toolbar contents with 12 emoji (👍 ❤️ 😂 🎉 👀 ✅ 🙏 🔥 💯 😮 😢 🚀), 28×28 each, width 364. Esc or leaving the message closes it. [proposed] v1 ships this fixed set; a full emoji picker is a later addition.

### 6.6 Selection quote

Selecting text inside a message (`[data-msg-text]`) shows a floating **Quote** button centered 38px above the selection: 30px, padding 0 10, gap 6, 1px `--border-default`, radius 8, bg surface, `--shadow-md`, `quote` 14 + "Quote" 12.5/500, z 35. Mouse-down on it inserts "> {selection}" lines into the composer, clears the selection and focuses the composer. Any other mouse-down dismisses it.

### 6.7 Thread link (Main only)

Under a Main message that has a thread: button 26px, margin-top 6, padding `0 8 0 6`, gap 6, 1px `--border-default`, radius 6, bg surface, fg subtle, 12.5px, max-width 100%: `messages-square` 13 · "2 replies" 600 default ("1 reply", "Thread" when only the root) · title ellipsis · `chevron-right` 12. Hover border `--border-strongest`. Click opens the topic (⌘-click new tab).

### 6.8 New divider and catch-up card

- Divider at the first unread message (never before the first message): margin `14 0 6`, gap 10, "3 NEW" 11/600 uppercase 0.06em in `--hl`, then a 1px rule `color-mix(var(--hl) 30%, transparent)`. The list opens scrolled so the divider sits 80px from the top; otherwise it opens at the bottom.
- Catch-up card, right after the divider when 2+ messages are new, AI assist on and a summary exists: margin `2 0 10`, padding `12 14`, radius 10, bg surface, `--card-ring`, gap 4. Header `sparkles` 13 + "Catch up" 12/500 muted. Body 13.5 lh 1.6 subtle.

### 6.9 Grouping suggestion (Main only)

Card above the first message when AI proposes a group: margin `4 0 14`, padding `12 14`, radius 10, `--card-ring`, gap 8.

- Header 12/500 muted with `sparkles` 13: "4 messages below look like one conversation".
- Row: suggested title 14/600 (flex 1) · **Group into topic** 28px radius 6 `--secondary-default` 12.5/500 · **Dismiss** ghost 28px muted.
- Footnote 11.5 muted: "Only your client stores this. Slack still shows these as channel messages."
- Group moves the first N messages into a new topic titled by AI (sparkle), and the card disappears. Dismiss hides it for that Main.

### 6.10 Settled hint (threads)

Card at the top of a thread when AI thinks it is settled: margin-bottom 16, padding `10 10 10 14`, radius 10, `--card-ring`, 13px, gap 10: `sparkles` 14 muted · "Looks settled. Priya is shipping two-line previews as the default." subtle · **Resolve** 28px secondary 12.5/500 · **Not yet** ghost. Hidden once dismissed, resolved, or AI assist is off. Shot 19.

### 6.11 Bubble style (tweak `messageStyle: bubbles`)

- Each message: column, align start (others) or end (me), padding 2 0, margin-top as flat.
- Others: name line "Leo Park 9:12" 12px (name 600 subtle, time muted), margin `0 0 3 40` (4 when avatars off), shown on the first of a group. Row: avatar 28 (visible only on the last of a group, otherwise reserved) + bubble, max-width 76%.
- Bubble: padding 8 12, 14px (density), lh 1.55. Others bg `--surface-hover`, radius 16 with 4px bottom-left corner on the last of a group. Mentions you: bg `--hl-soft`. Me: bg `--hl`, fg `--hl-fg`, radius 16 with 4px bottom-right corner, time 11 right-aligned inside, margin-top 2.
- Hover toolbar sits inline beside the bubble (centered vertically), not above. Thread link and reactions sit under the bubble with margin-left 36 for others.

## 7. Composer

**Shows:** S01 (empty "Reply"), S04 ("Message #eng"), S05 (route check), S06 (clarity check), shot 11-audience-guard, shot 12/13 (@ and # suggestions), shot 14 (grown).

- Outer padding `8 24 20`; inner wrapper max-width 752, centered, `position: relative`.
- Box: bg `--surface-default`, 1px `--input-border`, radius 12, overflow hidden. Rows inside: optional guard line, optional check bar, then the input row.
- Input row (align end, gap 4): **Attach** 28 round `plus` 18 subtle, margin `6 0 6 6`, name "Attach" (no behaviour in prototype; [proposed] opens the OS file picker) · textarea 1 row, padding `9 0 9 4`, 14px, lh 22px, min 40px, grows to 194px **[spec: ~8 lines]** then `overflow-y: auto` · **Send** 28 round bg `--hl` fg `--hl-fg` `arrow-up` 16, margin `6 6 6 0`, opacity .4 when the draft is empty (not disabled, so it stays focusable; [proposed] set `aria-disabled`).
- Placeholder: "Reply" in threads, "Message #eng" / "Message Maya Chen" in Main. No helper text anywhere.
- Drafts are kept per topic and survive tab switches.
- Keys: Enter sends; Shift+Enter newline. Sending clears the draft, ends stealth, marks the topic read, and reopens it if it was resolved.

### 7.1 @ and # suggestions

Typing `@` or `#` at a word start opens a popover above the composer: `bottom: calc(100% + 6px)`, left 12, width 280, z 5, padding 6, radius 13, `--pop-shadow`. Heading "People" / "Channels" 10.5 uppercase muted. Up to 6 rows, 32px, radius 6, padding 0 8, gap 10, 13px: avatar 20 or `hash`/`lock` 15 muted, name, right sub 11 muted (channel kind). Highlighted row bg `--surface-hover`. Filters as you type. ArrowUp/Down move, Enter or Tab inserts "@Maya Chen " / "#eng " and moves the caret, Esc closes, blur closes. DMs are not offered after "#".

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

Quote (toolbar) inserts the whole message as "> " lines; selection Quote inserts only the selection. Inserted at the end of the draft on its own lines, caret after, composer focused.

## 8. New message page

**Shows:** S08 (tracking on), shot 46 (empty To), shot 46c (To picker).

Scrolling page, inner max-width 680, padding `56 32`, gap 16.

- Title "New message" serif 34 lh 1.15, margin-bottom 8.
- **To** field: min-height 44, padding 0 12, 1px `--input-border`, radius 10, bg surface, gap 10, text cursor. Label "To" 13 muted. When a target is set: pill 28px, radius 6, padding 0 10, 13/600 with 400 kind, tinted like the header pill ("eng · Public channel"). Input 14px, placeholder "Channel or person" (empty) or "Change" (set). Prefilled with the channel of the topic you were viewing, or the current scope.
- Picker (on focus/click): below the field +4px, full width, max-height 300, padding 6, radius 13, `--pop-shadow`, z 10. Rows 34px, radius 6, 13.5px: avatar 20 or icon 15, name, right kind 12 muted ("Public channel", "Private channel", "Direct message", "Group DM"). Sorted by latest activity, filtered by the typed text. Empty: "No channel or person matches." Esc closes; mouse-down picks.
- Message textarea: 6 rows, padding 12 14, radius 10, 1px `--input-border`, 14px lh 1.6, resize vertical, placeholder "Write a message".
- Track box: padding 12 14, radius 10, 1px `--border-default`, gap 10. Checkbox 15px (`accent-color: var(--foreground-default)`), off by default, label "Track replies as a topic" 13.5/500, description "Slack posts this to Main either way. Replies to it are collected here as their own topic." 12.5 muted lh 1.45. When on: title input 36px, margin-left 25, padding 0 12, radius 8, 1px `--input-border`, 13.5, placeholder "Title (optional, only in your client). AI names it if empty."
- Footer, right-aligned, gap 8: **Discard** 36px padding 0 14 radius 8 `--secondary-default` 13/500 (closes the tab) · **Send** 36px padding 0 16 bg `--hl` fg `--hl-fg`, opacity .4 until there is text and a target.
- Send posts to Main; with tracking on it also creates the topic (with the thread link under the Main message) and the tab becomes that topic; otherwise the tab becomes the Main thread, scrolled to the bottom.

## 9. ⌘K palette

**Shows:** S07 (send command), shot 04 (recent), shot 05b (resolve command), shot 05c (people search), shot 62 (dark).

- Overlay: `position: absolute; inset 0`, bg `rgba(27,28,21,0.16)`, z 30, click closes. Panel 560px (max calc(100% − 48px)) at top 96, radius 14, `--pop-shadow`, overflow hidden.
- Header: padding 14 16, border-bottom 1px `--border-default`, gap 10: `search` 18 muted · input 15px, placeholder "Search, or tell Juno: message maya the slot works" · kbd "esc" (mono 10, padding 1 5, 1px `--border-strong`, 2px bottom, radius 4, subtle).
- List: padding 6, max-height 400, contained scroll. Heading 10.5 uppercase muted, padding `8 10 4`: **Recent** (empty query), **Results** (search), **Juno** (a command is recognised). Rows: padding 8 10, radius 8, gap 12, measured 55px: icon 16 muted · label 14 ellipsis + sub 12 muted · optional confidence badge · hint 11 muted on the active row only. Active row bg `--surface-hover`; mouse hover moves the active row.
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
  | no DM exists | No DM with Jonas Weber yet | (prototype limitation; see open questions) | `user` | |

  A send command posts straight into that Main with the toast "Posted in Maya Chen · Main" and Undo (⌘Z). Search results still follow below the command (up to 6).
- Keys: ⌘K toggles (also closes). ArrowUp/Down move; Enter runs the active row; ⌘Enter opens a topic result in a new tab (hint "⌘ Enter for new tab"); Esc closes. Input is autofocused.

## 10. All topics page

**Shows:** S09, shot 40b (Resolved filter), shot 40c (empty), shot 64 (dark).

- Header: padding `32 40 16`, gap 18, border-bottom 1px `--border-subtle`. Title "All topics" serif 32 lh 1.1; sub "Everything you're part of, including quiet, resolved and unsubscribed topics." 13 muted. Right: search field 260×34, radius 8, 1px `--input-border`, `search` 14 muted, placeholder "Filter by title or message", 13px. Wraps under the title on narrow windows.
- Filter row (gap 2, wraps): status chips 28px radius 7 padding 0 10 13/500 with the count in 400 muted: **All 21 · Open 15 · Resolved 1 · Quiet 4 · Unsubscribed 1**. Selected bg `--secondary-default` fg default; others transparent muted. Right: three selects 30px, radius 7, 1px `--input-border`, bg surface, 13px: "Channels and DMs | Channels | DMs", "Anywhere | #eng | … | Maya Chen", "Most recent | Oldest first | Most messages". [proposed] native `<select>` is fine on macOS.
- Table: padding `4 28 40`, horizontal scroll on narrow windows. Grid `minmax(200px,1fr) minmax(0,150px) 104px 44px 84px`, gap 16. Header row 11/500 uppercase 0.06em muted, padding 10 12: TOPIC · WHERE · STATUS · MSGS (right) · UPDATED (right).
- Row: `role="button"`, min-height 52, padding 8 12, radius 8, border-bottom 1px `--border-subtle`, hover `--surface-hover`, gap 1 between lines.
  - Topic: title 14 (600 unread, else 500) ellipsis + Main tag + `pin` 12 muted if pinned; preview "Sender: text" 12.5 muted ellipsis.
  - Where: channel icon 13 + name, 13 subtle.
  - Status chip 22px, padding 0 8, radius 6, 12/500: Open (`--secondary-default` / subtle), Resolved (success tint), Quiet and Unsubscribed (transparent, muted).
  - Msgs 13 subtle tabular right; Updated 13 muted tabular right ("3m", "1h", "Yesterday").
- Click opens (⌘-click new tab); right-click gives the row context menu, so Reopen and Subscribe happen here. Empty: "No topics match these filters." centered 13 muted, padding 48.
- Status definition: resolved → Resolved; unsubscribed → Unsubscribed; older than the quiet window and not pinned/unread → Quiet; else Open. Ignored channels are excluded.

## 11. For you page

**Shows:** S10 (Coding agent, Waiting on you), shot 41c (Reply ideas, Follow-up, Tidy up).

Page max-width 720, padding `40 32 64`, gap 12. Title "For you" serif 34; sub "Things Juno noticed across your topics. Take one to Juno, open the topic, or dismiss it." 14 lh 1.6 subtle; header margin-bottom 12.

Card: padding 14 16, radius 10, bg surface, `--card-ring`, gap 10.

- Header 12 muted, gap 8: type icon 13 · type name 500 subtle · "·" · source icon 11 + topic title (ellipsis) · spacer · dismiss 22×22 radius 5 `x` 12 (name "Dismiss").
- Title 15/600 lh 1.35. Body 13.5 lh 1.55 subtle.
- Actions row (wrap, gap 6): buttons 30px, padding 0 12, radius 7, 13px. Primary: bg `--secondary-default`, 500. Others: ghost, fg subtle, 400. Hover `--secondary-hover`.

| Type | Icon | Extra block | Actions |
| --- | --- | --- | --- |
| Coding agent | `terminal` | Prompt block: mono 12.5 lh 1.6, padding 10 12, radius 8, 1px `--border-default`, bg `--background`, max-height 150, scrolls, pre-wrap, selectable | **Copy prompt** (toast "Prompt copied", no Undo) · Refine with Juno · Open topic |
| Waiting on you | `reply` | Reply starters: buttons min-height 36, padding `6 10 6 12`, 1px `--border-default`, radius 8, 13.5 lh 1.45, left-aligned text + "Use" 11.5 muted at right; hover bg `--surface-hover` border `--border-strong`; title "Open the topic with this in the reply box" | Ask Juno · Open topic |
| Reply ideas | `lightbulb` | Same option list ("Three directions. Pick one to start from.") | Open topic |
| Follow-up | `calendar-check` | none | **Mark done** (toast "Follow-up done") · Open topic |
| Tidy up | `circle-check` | none; source shows nothing (several topics) | **Resolve both** (undo toasts per topic) · Review |

"Use" opens the topic with the text in the composer and focuses it. "Ask Juno" / "Refine with Juno" switches to the Juno tab and sends a prepared question. Dismiss removes the card; cards whose topic is resolved disappear by themselves. Empty: "Nothing right now." centered 13 muted, padding 48 0. The For you nav count = number of live cards.

## 12. Juno chat

**Shows:** S11 (empty), shot 43 (reply with send, topics and resolve cards), shot 43b (sent state), shot 63 (dark).

Single long thread, no "new chat". Scroll container; column max-width 720, padding `40 32 24`, gap 20; scrolls to the bottom on each new message.

- **Empty state** (padding-top 40, gap 18): "What do you need?" serif 38 lh 1.1 · "Ask it to find, summarize, triage or route. It can read your topics and propose messages, but nothing is sent until you press Send." 14 lh 1.6 subtle max-width 520 · suggestion chips (wrap, gap 8): 34px, padding 0 12, 1px `--border-strong`, radius 8, bg surface, 13px: "Summarize what I missed today", "Summarize this topic", "Tell Maya the Wednesday slot works for eng", "Anything settled I can resolve?". Clicking sends the text.
- **User message**: align end, max-width 80%, padding 9 14, radius `14 14 4 14`, bg `--secondary-default`, 14 lh 1.55, pre-wrap.
- **Assistant message**: row, gap 12: mark 28 round bg `--surface-hover` with `sparkles` 14 subtle · column (padding-top 3, gap 10): text 14 lh 1.65 pre-wrap (plain text, no markdown, no emoji) then cards.
- **Busy**: same mark + "Looking through your topics…" 13 muted. Input placeholder becomes "Working…" and Ask is dimmed.
- **Error**: assistant text "Couldn't reach the assistant. Try again in a moment."
- **Send card** (proposed message): padding 12, radius 10, `--card-ring`, gap 10. Header 12 muted: "Send to" · context pill 22px (icon 11, 600 name, 400 kind) · "in {topic title}" when replying inside a thread. Pending: textarea 2 rows, padding 8 10, radius 8, 1px `--input-border`, bg `--background`, 14 lh 1.55, editable; footer right: **Dismiss** ghost 30px muted radius 7 · **Send** 30px padding 0 14 bg `--hl` fg `--hl-fg` 13/500. After Send: header reads "Sent to", text 14 subtle, footer "Sent 13:45" 12 muted + underlined **Open** link (12, subtle) that opens the topic. After Dismiss: "Dismissed".
- **Topics card** (links): padding 4, radius 10, `--card-ring`, gap 2. Rows 36px, padding 0 10, radius 7, hover `--surface-hover`: channel icon 13 muted · title 13.5/500 ("#eng · Main" for Main) · where 12 muted. Click opens (⌘-click new tab).
- **Resolve card**: padding 12, radius 10, gap 8. "Resolve 2 topics" 12 muted; rows 13.5 with icon 13 + title + where 12 muted; footer **Dismiss** ghost · **Resolve** 30px secondary 500. After: "Resolved" / "Dismissed" 12 muted.
- **Input**: outer padding `8 24 20`; box max-width 672, bg surface, 1px `--input-border`, radius 12; textarea padding `9 0 9 14`, 14 lh 22, max-height 160; **Ask Juno** button 28 round `arrow-up`, margin 6, opacity .4 when empty or busy. Placeholder 'Ask Juno, like "what did I miss in #eng?"'. Enter sends, Shift+Enter newline. No attach button here.
- "This" refers to the last viewed topic. Tools (list topics, read topic, list channels, propose message, show topics, propose resolve) are backend; the three card types above are the only UI they produce.

## 13. Notifications page

**Shows:** S12 (top), shot 44b (digest, quiet hours), shot 44c (Today log).

Page max-width 880, padding `40 40 72`, gap 36.

- Title "Notifications" serif 34; sub "Everything is in Juno whenever you open it. This only decides when your Mac interrupts you: right away, in a digest, or not at all." 14 lh 1.6 subtle max-width 620.
- **Today so far** line (13 subtle, gap 8, margin-top 8): chips 24px, padding 0 9, radius 6, gap 6, count 600 tabular + label 500: "4 interrupted you" (bg `--hl`, fg `--hl-fg`), "5 waited for a digest" (`--secondary-default` / subtle), "3 stayed silent" (`--surface-hover` / muted).
- Section pattern: heading 15/600 + sub 13 muted (gap 2), then a group card (radius 10, bg surface, `--card-ring`, rows divided by 1px `--border-subtle`).

**Your rules** — "Checked top to bottom. The first rule that matches wins."

- Rule row: min-height 48, padding `8 10 8 14`, gap 12: type icon 15 muted (`hash` channel, `user` person, `at-sign` mention, `text-search` keyword) · text 14 "In **#incidents**" / "From **Maya Chen**" / "Mentions of me in **hiring**" / "Contains **"lunch"**" · hits 12 muted "2 today" (blank at zero) · segmented control · remove 26×26 radius 6 `x` 13 muted (name "Remove rule").
- Segmented control: padding 2, bg `--surface-hover`, radius 7, gap 2; segments 24px, padding 0 9, radius 5, 12/500: **Now · Digest · Silent**. Selected: bg surface, fg default, `--shadow-sm`; others transparent muted.
- New rule row: padding `10 10 10 14`, gap 8, wraps: "New rule" 13 muted · select type ("From a person | In a channel or DM | Mentions of me in | Contains") · select value (people, or channels/DMs; for Contains a 160px text input, placeholder "word or phrase") · select action ("Notify now | Put in digest | Stay silent") · **Add** 32px secondary. Selects/inputs 32px, radius 7, 1px `--input-border`, 13px.

**Everything else** — "When no rule matches."

- Checkbox row (padding 14): 15px checkbox, "Let Juno decide" 14/500, "Each message gets a quick read on urgency. Off means everything waits for a digest." 13 muted lh 1.5.
- Threshold row (only when on): "Interrupt me only when Juno is at least **80%** sure it's urgent" 14; range slider 200px, min 50, max 95, step 5, default 80, `accent-color: var(--foreground-default)`. [proposed] custom slider: 4px track `--border-strong`, filled part `--foreground-default`, 14px round thumb with `--card-ring`.
- Digest times row: "Digest times" 14 (flex 1 1 180px) · chips 28px, radius 7, bg `--secondary-default`, padding `0 4 0 10`, 13/500, with 20×20 `x` remove (name "Remove"): "10am", "1pm", "4:30pm" · select "Add a time" offering 7:00–20:30 in half hours not already used. Defaults 10am, 1pm, 4:30pm.
- Quiet hours row: "Quiet hours" 14 · select from (hours "12am"…"11pm") · "to" 13 muted · select to · note "Rules set to Now still come through." 12.5 muted. Default 7pm to 8am.

**Today** — "How the messages that have arrived so far were handled. Change a rule above and this updates."

- Log rows (newest first): grid `44px minmax(0,150px) minmax(0,1fr) 84px minmax(0,170px)`, gap 14, min-height 44, padding 6 4, border-bottom 1px `--border-subtle`, 13px: time muted tabular "13:42" · where (icon 12 + name) subtle · "**Dev** @Leo I think the preview…" ellipsis · decision chip 22px radius 6 12/500: "Now" (accent), next digest time "1pm" (secondary), "Silent" (transparent muted) · why 12 muted: "Rule: In #incidents", "Rule: From Maya Chen", "Rule: Mentions of me in hiring", "Rule: Contains "lunch"", "Juno · 89% urgent", "Juno · 14% urgent, can wait", "Juno · 66% just chatter", "Quiet hours", "Juno off, waiting for digest", "Ignored channel".
- Decision order: ignored channel → rules top to bottom → quiet hours (digest, unless a rule said Now) → Juno off (digest) → Juno score vs threshold (now) → chatter (silent) → digest.

## 14. Preferences

**Shows:** S13.

Page max-width 760, padding `40 40 72`, gap 36. Title "Preferences" serif 34.

- **Ignored channels** — "Hidden from your topics, search and All topics, and they never notify you. Nothing changes in Slack." Group card: rows min-height 48, padding `8 10 8 14`: channel icon 15 muted · name 14/500 · "3 messages hidden" 12 muted · **Stop ignoring** 28px secondary 12.5/500. Empty row "Nothing ignored." 13 muted padding 14. Add row: "Ignore" 13 muted · select of non-ignored channels 32px · **Ignore** 32px secondary · right hint "You can also right-click a channel to ignore it" 12 muted. Ignoring shows the toast "Ignoring #deploys" with Undo. DMs cannot be ignored.
- **Notifications** — "Rules, digest times and quiet hours." Button **Open notification settings** 34px, padding 0 12, 1px `--border-strong`, radius 8, bg surface, `bell` 14, 13/500.
- [proposed] The tweaks in §19 that are user preferences (row style, density, preview lines, avatars, grouping, quiet window, message style, accent, theme, AI assist) also live on this page as a "Appearance" group; the prototype only exposes them through the design-tool panel.

## 15. Context menus

Native menus **[spec]**. Prototype rendering for reference: 236px, padding 5, radius 13, `--pop-shadow`, z 40, positioned at the pointer and clamped 8px inside the window (246px from the right edge, 340px from the bottom); from the header More button it is right-aligned 4px below the button. Items 30px, radius 6, padding 0 8, gap 10, 13px, icon 15 subtle, right hint 11 muted; separators 1px `--border-default` margin 4 6. Esc or outside click closes. Every item closes the menu.

**Shows:** S02, shot 22 (header More), shot 23 (tab), shot 32 (channel), shot 61 (dark).

### 15.1 Topic row / tab / header More

| Item | Icon | Hint | Shown when | Effect |
| --- | --- | --- | --- | --- |
| Open in new tab | `square-arrow-out-up-right` | ⌘ click | always | |
| Open in stealth | `eye-off` | Stays unread | always | |
| — | | | | |
| Rename | `pencil` | | not Main | inline rename in the row (or header when opened from More) |
| Use AI title | `sparkles` | | manual title exists, AI title exists, AI assist on | clears the manual title |
| Mark as read / Mark as unread | `check-check` / `circle-dot` | | by state | unread sets count to at least 1 |
| Pin / Unpin | `pin` / `pin-off` | | by state | |
| Unsubscribe / Subscribe | `bell-off` / `bell` | | by state | undo toast |
| Resolve / Reopen | `circle-check` / `rotate-ccw` | | by state | undo toast; resolve clears unread and mention |
| — | | | | |
| Copy Slack link | `link` | | always | |
| Ignore #product | `ban` | | channel is not a DM | toast "Ignoring #product" with Undo |

### 15.2 Channel menu (Browse popover rows)

| Item | Icon | Hint | Shown when |
| --- | --- | --- | --- |
| Show its topics | `list-filter` | | always |
| Open Main | `message-square` | | Main exists |
| Open Main in stealth | `eye-off` | | Main exists |
| — | | | |
| Mark channel as read | `check-check` | | always (clears unread on every topic in it) |
| Mark channel as unread | `circle-dot` | | always (marks the latest topic unread) |
| — | | | not DM |
| Ignore channel | `ban` | Hide in Juno | not DM |

## 16. Toasts

**Shows:** shot 18-toast-undo.

- Position: bottom-left, left 16, bottom 16, z 45, max-width 352. Padding `8 8 8 14`, radius 10, bg `--foreground-default`, text `--background`, `--shadow-lg`, 13px, gap 12. Text ellipsis on one line.
- Undo button (reversible actions only): 26px, padding 0 8, radius 6, bg `color-mix(var(--background) 16%, transparent)`, "Undo" 12.5/600 + "⌘Z" mono 11 at .75 opacity.
- One toast at a time; a new one replaces the old. Auto-dismiss 5s (with Undo) or 4s (info). No enter/exit animation in the prototype; [proposed] 150ms fade is acceptable.
- Undo stack holds 20 actions; ⌘Z pops the last one (resolve, reopen, subscribe, unsubscribe, ignore, routed post, command send) when focus is not in a non-empty input.

| Copy | Undo |
| --- | --- |
| Resolved · Postgres 16 migration plan | yes |
| Resolved · #eng (Main rows use the channel label) | yes |
| Reopened · … / Unsubscribed · … / Subscribed · … | yes |
| Ignoring #deploys | yes |
| Posted in Staging bill doubled since August · Posted in #eng · Main | yes |
| Prompt copied | no |
| Follow-up done | no |

## 17. Empty states

| Where | Copy | Style | Shows |
| --- | --- | --- | --- |
| Workspace, no tabs | "Nothing open" / "Pick a topic, or press ⌘K to find one." | centered; serif 30 subtle; 13 muted; gap 8 | shot 47 |
| Sidebar list | see §2.6 | | shot 48 |
| All topics table | "No topics match these filters." | 13 muted, padding 48 | shot 40c |
| For you | "Nothing right now." | 13 muted, padding 48 0 | |
| Juno | "What do you need?" + suggestions | §12 | S11 |
| ⌘K | "No matches." | 13 muted, padding 20 10 | |
| Browse | "No match." | 13 muted | |
| To picker | "No channel or person matches." | 13 muted | |
| Ignored list | "Nothing ignored." | 13 muted | |
| Thread with no replies (thread link) | "Thread" instead of "N replies" | | |

[spec] Empty states say why and offer one next step; All topics, For you, ⌘K and Browse empties in the prototype have no action. [proposed] add "Clear filters" to the All topics empty state.

## 18. Dark mode

**Shows:** S15, shots 60–65.

- Trigger: Theme button in the sidebar bar (or OS setting; [proposed] default "follow system", with the button overriding). Root gets `data-theme="dark"` and the dark token block (tokens §1.2) applies; nothing else changes.
- During the switch the root carries `data-theme-switching` for two frames so every transition is disabled and colours change at once.
- Dark-only values: `--input-border hsla(210,5%,24%)`, `--card-ring 0 0 0 1px oklch(1 0 0/.08)`, `--pop-shadow 0 0 0 1px oklch(1 0 0/.1), 0 8px 24px oklch(0 0 0/.5)`; tints and `--hl-soft` recompute from the dark base. Accent ink flips to light (#EDEADE) with near-black text; the four colour accents stay the same hex.
- Everything else (sizes, weights, icons) is identical. Check: resolved chip text in dark is 4.48:1 (borderline); cyan accent chip text fails (tokens §1.3).

## 19. Tweaks and defaults

Exposed in the prototype's design panel (`data-props`). Store them as user preferences.

| Tweak | Options | Default | Affects |
| --- | --- | --- | --- |
| rowStyle | chat, list, cards | chat | §3.3 |
| density | compact, balanced, airy | balanced | §3.4, §6.1 message padding/size/spacing |
| previewLines | 1, 2 | 2 | §3.1 line 2 clamp |
| showAvatars | on, off | on | Row tile (chat) / avatar stack (list, cards); message avatars and bubble indent |
| grouping | flat, channel | flat | §2.5 sections |
| quietDays | 1–30 | 7 | Hide window; copy in empty state, Browse "quiet" meta, All topics Quiet status |
| messageStyle | flat, bubbles | flat | §6.1 vs §6.11 |
| aiAssist | on, off | on | Hides: AI sparkle on titles, catch-up card, grouping card, settled hint, send checks, audience warning, "Use AI title" item; ⌘K still searches. [spec] also turns off notification gating, For you and Juno |
| accent | #1B1C15 ink, #2E1F64 midnight blue, #00674F dark emerald, #7F1734 claret, #008AB3 cyan | ink | `--hl`, `--hl-fg`, `--hl-soft` |
| dark | on, off | off | §18 |

## 20. Keyboard map

| Keys | Where | Action |
| --- | --- | --- |
| ⌘K | anywhere | Toggle palette |
| ⌘J | anywhere | Open Juno tab and focus its input |
| ⌘Z | anywhere, unless focus is in a non-empty input | Undo last reversible action |
| ⌘, | anywhere | Preferences (shown in the avatar menu; [proposed]) |
| Esc | anywhere | Close palette, picker, menus, popovers; dismiss send check; cancel rename |
| Enter / Space | any `role="button"` (rows, tabs, menu items, palette rows, Juno topic links) | Activate |
| ⌘ click / ⌘ Enter | rows, tabs, links, palette, cards' Open topic | Open in a new tab |
| Enter / Shift Enter | composer, Juno input | Send / newline |
| Enter / Esc | while a send check is shown | First option / back to editing |
| ↑ ↓, Enter or Tab, Esc | @ and # suggestions | Move, insert, close |
| ↑ ↓, Enter, ⌘Enter, Esc | palette | Move, open, open in new tab, close |
| Enter | Browse search | Pick the first match |
| Enter / Esc / blur | rename | Save / cancel / save |
| Context-menu key, right-click | rows, tabs, Browse rows, All topics rows | Menu |
| Tab order | sidebar bar → nav → filters → rows → tab strip → header → messages → composer | Hover-only actions (row Resolve, message toolbar) appear on focus |

## 21. Shared copy

- Relative time: "now", "4m", "2h", "Yesterday", "3d" (under 14 days), then "2w". Prototype formula; SPEC lists "4m, 2h, Yesterday, 3d".
- Message times: "9:12", "Yesterday", "Sat", "Oct 3".
- Channel kinds: "Public channel", "Private channel", "Direct message", "Group DM".
- Main labels: "#eng · Main", "Maya Chen · Main"; tab shows "eng"; row shows "#eng" + Main tag; header sub "Messages posted outside threads".
- "#" is never repeated next to a hash icon (pills, tabs, row line 3, table Where column).
- Never emoji in chrome; reactions and user text are the user's own.
