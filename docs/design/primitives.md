# Juno UI primitives

A proposed set of dumb, reusable primitives, derived from the repeated patterns in the design (`inventory.md`). Each is a thin React + StyleX component with no data fetching and no app state. Feature components (TopicRow, MessageList, Palette, …) compose these. The list is deliberately short; add a primitive only when a third use appears.

Shared conventions for every primitive:

- No `cursor: pointer`. Hover styles only under `@media (hover: hover)`.
- Press feedback `scale(0.96)` at 150ms ease-out, suppressed when disabled.
- Visible focus ring only on `:focus-visible`.
- Icon-only controls require an accessible name (`aria-label` or `title` mirrored to `aria-label`).
- Sizes, colours, radii and durations come from tokens; no literal values in components.
- `user-select: none` by default; text-bearing primitives (Text, TextField, Textarea, CodeBlock) opt in.

## 1. Icon

Lucide icon wrapper. `stroke="currentColor"`, no fill.

| Prop | Values |
| --- | --- |
| `name` | lucide name |
| `size` | 11, 12, 13, 14, 15, 16, 18 (default 16) |
| `opacity` | optional, used for tab icons (0.75) |

## 2. Button

One component for every clickable control with a label.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `accent` (bg `--hl`, fg `--hl-fg`), `secondary` (bg `--secondary-default`, hover `--secondary-hover`), `outline` (1px `--border-strong`, hover `--border-strongest` or `--surface-hover`), `ghost` (transparent, fg subtle or muted, hover `--surface-hover` / `--secondary-default`), `raised` (bg surface + `--shadow-sm`, hover bg `--background`; send-check primary) | |
| `size` | `xs` 22, `sm` 28, `md` 30, `lg` 32, `xl` 34, `2xl` 36 | Height; horizontal padding 8 / 10 / 12 / 12 / 12 / 14–16 |
| `radius` | 6 (xs, sm), 7 (md), 8 (lg and up) | Derived from size by default |
| `iconStart`, `iconEnd` | Icon | 12–14px |
| `kbd` | string | Trailing mono hint, e.g. "↵" |
| `pressed` | boolean | Selected state for toggles (Pin, filters, status chips): bg `--secondary-default`, weight 600 when a text chip |
| `dimmed` | boolean | opacity .4, still focusable, `aria-disabled` (Send with empty draft) |
| `disabled` | boolean | No press scale |
| `fullWidth`, `align` | | Nav buttons |

Covers: nav items, quick filters, status chips, Resolve (row and header), Group into topic, Dismiss, Not yet, Discard/Send, card actions, suggestion chips, Stop ignoring, Add, Ignore, segmented-control segments (use `Segmented`), Mark read, Undo.

## 3. IconButton

Button with only an icon. Same variants (`ghost` default, `secondary` when pressed).

| Prop | Values |
| --- | --- |
| `size` | 20, 22, 26, 28, 30, 32 |
| `radius` | 4 (20–22), 5 (22 dismiss), 6 (26–28), 8 (30–32), `full` (attach, send, avatar button) |
| `icon`, `iconSize` | 11–18 |
| `label` | required accessible name |
| `pressed`, `dimmed` | as Button |

Covers: title bar icons, tab close, scope chip close, header Pin/Subscribe/More, hover-toolbar buttons, More reactions, attach, send, dismiss (cards, rules, digest chips), new tab.

## 4. Tile and Avatar

`Tile`: square with a letter for channels. `Avatar`: circle with initials for people. Both take `size` and render initials at the matching font size.

| Size | Initials | Use |
| --- | --- | --- |
| 44 (tile radius 10) | 14 | Sidebar row (balanced/airy) |
| 36 | 14 | Sidebar row (compact) |
| 32 | 12 | Flat message, avatar menu |
| 28 | 11 | Bubble message, Juno mark |
| 24 | 9.5 | Me button |
| 20 | 9 | Suggestion rows, To picker |
| 18 | 8.5 / 7.5 | Browse rows / AvatarStack |

Props: `kind` (`channel` | `person` | `group`), `label` (letter or initials; group = member initials), `hue` (person colour; derives bg/fg via the color-mix formulas), `ring` (1.5px `--background-subtle`, for stacks).

**AvatarStack**: `people[]`, `max` (4), `size` (18), overlap −4. Each child gets `ring`.

## 5. Chip

Small inline label. Replaces tags, count badges, status chips, decision chips, summary chips, confidence badge, kbd hint badge.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `outline` (1px `--border-strong`; Main), `filled` (`--secondary-default`; Reopened, Open, Digest, digest times), `strong` (`--secondary-active`; unread count, For you count), `soft` (`--hl-soft` + inset `--border-strong` ring; @), `accent` (`--hl` / `--hl-fg`; Now, @ in Browse), `success` (resolved tint), `quiet` (transparent, muted text; Quiet, Silent, Unsubscribed), `surface` (`--surface-hover`; "stayed silent" summary) | |
| `size` | 18 (tags), 20 (badge), 22 (status), 24 (summary, reaction), 28 (removable) | Padding 0 5 / 0 6 / 0 8 / 0 9 / 0 4 0 10 |
| `icon` | Icon 11–13 | sparkle in confidence badge |
| `numeric` | boolean | tabular figures |
| `onRemove` | handler | Adds a 20×20 close IconButton (digest times, scope chip) |
| `title` | tooltip text | "Mentions you", "Messages posted … outside any thread" |

Reaction chips are a Chip with `variant` `outline`/`soft` and a `pressed` state, as a `button`.

## 6. ContextPill

The channel-kind pill. Everything that shows "where".

| Prop | Values |
| --- | --- |
| `kind` | `public` \| `private` \| `dm` \| `group` → tint tokens and icon (`hash`, `lock`, `user`, `users`) |
| `name` | channel or person name, no "#" |
| `showKind` | boolean, appends " · Public channel" at weight 400 |
| `size` | 22 (Juno card), 26 (header), 28 (To field) |

The stealth pill is not a ContextPill. It is a `Chip` with a `dashed` variant (1px dashed `--border-strongest`, 26px, trailing "Mark read" Button); add `dashed` to Chip rather than a new primitive.

## 7. Kbd

Keyboard hint. `mono 10–11px`. Two looks: `plain` (just text, muted; "⌘J", "⌘Z", "↵", "⌘ click") and `key` (1px `--border-strong`, 2px bottom border, radius 4, padding 1 5; "esc").

## 8. Text

Typography helper mapping a role name to size/weight/line-height/colour from tokens §2.2: `sectionLabel`, `tableHeader`, `meta`, `ui`, `preview`, `bodySmall`, `body`, `rowTitle`, `heading`, `topicTitle`, `pageTitle`, `display`. Props: `role`, `tone` (`default` | `subtle` | `muted` | `accent`), `truncate` (1 line ellipsis), `clamp` (n lines), `numeric`, `selectable`.

## 9. Surface

Container styles.

| Prop | Values |
| --- | --- |
| `kind` | `card` (bg surface, `--card-ring`, border 1px transparent, radius 10), `popover` (bg surface, `--pop-shadow`, radius 13 or 14, padding 5–6), `toolbar` (popover with radius 9, padding 2), `group` (card with no padding; rows separated by 1px `--border-subtle`), `inset` (bg `--background`, 1px `--border-default`, radius 8; prompt block, send-card textarea), `toast` (bg `--foreground-default`, fg `--background`, `--shadow-lg`, radius 10) |
| `padding` | token |

`Divider`: 1px `--border-default` (menus, hairline) or `--border-subtle` (rows); props `inset` (margin), `vertical`.

`LabelledRule`: the "3 NEW" divider — label + 1px rule in a colour; props `label`, `tone` (`accent`).

## 10. Popover and Menu

`Popover`: positions a `Surface kind="popover"` relative to an anchor or a point; closes on Esc and outside click; traps scroll (`overscroll-behavior: contain`, `max-height`); `z` from the layer tokens. Props: `anchor` | `point`, `placement`, `width`, `maxHeight`, `onClose`.

`Menu` + `MenuItem` (DOM fallback; native menus are used for context menus): item 30 or 32px, radius 6, padding 0 8, gap 10, `icon` 15 subtle, `label`, `hint` (11 muted), `selected` (bg `--secondary-default`), `onSelect`; `MenuSeparator`; `MenuHeader` (avatar + two lines). Keyboard: arrows, Enter, Esc, type-ahead optional.

`OptionList` + `OptionRow`: the searchable list used by Browse, @/# suggestions, To picker, ⌘K. Row props: `leading` (Icon or Avatar), `label`, `sub` (muted, inline or second line), `trailing` (Chip or Kbd), `active` (bg `--surface-hover`), `size` (32, 34, or 55 two-line). Mouse-down selection for lists that live over an input (so the input keeps focus). `OptionGroupLabel` = Text `sectionLabel`.

## 11. Tabs

`TabStrip` (44px drag region, align end, gap 2, overflow hidden) + `Tab` (`icon`, `label`, `active`, `onClose`, `onContextMenu`; 35px, radius 8 8 0 0, flex 0 1 230, min 72) + trailing slot for the new-tab IconButton.

## 12. Fields

`TextField`: 1px `--input-border`, bg surface, radius 7–10 by size; sizes 30, 32, 34, 36, 40 (inside To field), 44 (To field container); `leadingIcon` (search 14), `leading` slot (the "To" label and a ContextPill), `placeholder`, `size`. Unstyled inner `<input>` with `outline: none`; the container shows focus.

`Textarea`: same border; variants `plain` (New message, 6 rows, resize vertical), `inline` (composer: no border of its own, lh 22px, auto-grow to `maxHeight`, then scrolls), `card` (send card, bg `--background`, 2 rows).

`Composer`: feature component, not a primitive, but it is only `Surface(radius 12) + slots(top) + IconButton + Textarea inline + IconButton`.

`Select`: native `<select>` styled like TextField size 30/32; `options[]`, `value`.

`Checkbox`: 15px native with `accent-color: var(--foreground-default)`; label (13.5–14/500) + description (12.5–13 muted) layout.

`Slider`: `<input type="range">` with `accent-color` (prototype) or the custom track/thumb from inventory §13; props `min`, `max`, `step`, `value`, `width`.

`Segmented`: container padding 2, bg `--surface-hover`, radius 7; segments are Buttons 24px radius 5, selected = bg surface + `--shadow-sm`. Props `options[]`, `value`, `onChange`.

`SearchField` = TextField with `leadingIcon="search"`.

## 13. ListRow

Generic row for settings groups, log rows and table rows: `min-height` (44, 48, 52), padding, `grid` template or flex, bottom `Divider`, optional `role="button"` with hover `--surface-hover` and radius 8. Slots: `leading`, `children`, `trailing`. Sidebar topic rows and All topics rows are feature components built on this.

## 14. Toast

`Toast`: Surface `toast`, 13px, `text` (truncate), optional `action` ({label: "Undo", kbd: "⌘Z"}), auto-dismiss duration. `ToastHost` renders one at bottom-left (16/16, z 45) and replaces on new.

## 15. EmptyState

Centered column: `title` (Text `ui` 500, or `display` serif 30 subtle for the workspace), `body` (13 muted lh 1.5), optional `action` Button `secondary` 30px. Padding 48.

## 16. PageHeader

Serif `title` (34; 32 in All topics; 38 display), optional `subtitle` (13–14 subtle/muted, max-width 520–620), optional `trailing` slot (search field). Sets the page's max-width and padding by `width` prop (`narrow` 680, `default` 720, `settings` 760, `wide` 880).

`Section`: `heading` 15/600 + `sub` 13 muted + children (a `Surface kind="group"`), gap 12.

## 17. CodeBlock

Mono 12.5 lh 1.6, `Surface inset`, pre-wrap, max-height 150 with scroll, selectable. For you prompt only.

## 18. Card (composition, not new CSS)

`Card` = `Surface card` with `header` (12 muted row: Icon 13, kind, "·", source), `title` (15/600), `body` (13.5 subtle), `children`, `actions` (Button row gap 6), `onDismiss` (22px IconButton). Used by For you cards and Juno cards; the message-level cards (catch-up, grouping, settled) use `Surface card` directly.

---

## What is not a primitive

Feature components that compose the above and hold app logic: `Sidebar`, `TopicRow`, `TopicHeader`, `MessageList` / `Message` / `Bubble`, `MessageText` (token segmenting into Chips), `HoverToolbar`, `Composer` (with `SendCheckBar`, `AudienceWarning`, `MentionSuggest`), `CommandPalette`, `AllTopicsTable`, `ForYouCard`, `JunoThread` (+ `SendCard`, `TopicsCard`, `ResolveCard`), `NotificationRules`, `IgnoreList`, `NewMessageForm`, `ContextMenu` (native bridge).

## Count

18 primitives: Icon, Button, IconButton, Tile/Avatar (+AvatarStack), Chip, ContextPill, Kbd, Text, Surface (+Divider, LabelledRule), Popover/Menu/OptionList, Tabs, Fields (TextField, Textarea, Select, Checkbox, Slider, Segmented), ListRow, Toast, EmptyState, PageHeader/Section, CodeBlock, Card.
