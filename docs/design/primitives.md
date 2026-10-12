# Juno UI primitives

The dumb, reusable primitives in `packages/ui`, derived from the repeated patterns in the design (`inventory.md`). Each is a thin React + StyleX component with no data fetching and no app state. Feature components (TopicRow, MessageList, Palette, …) compose these. The list is deliberately short; add a primitive only when a third use appears.

Shared conventions for every primitive (details in `packages/ui/README.md`):

- No `cursor: pointer`. Hover styles only under `@media (hover: hover)`.
- Press feedback `scale(0.96)` at 150ms ease-out, suppressed when disabled.
- Visible focus ring (`--focus-ring`, 2px) only on `:focus-visible`.
- Icon-only controls require an accessible name (`label`).
- Sizes, colours, radii and durations come from tokens; no literal values in components.
- `user-select: none` by default; text-bearing primitives (Text `selectable`, TextField, Textarea, CodeBlock) opt in.
- Things that navigate (ListRow with `onSelect`, Tab, OptionRow, NavItem) activate on `pointerdown` with the primary button; ⌘ passes through for "open in new tab", right-click goes to `onContextMenu`, Enter/Space work, nested controls are ignored. No transition on their background.
- Muted text never sits on a secondary fill: a container with such a fill (ListRow `selected`) sets `--foreground-muted` to the subtle value on itself, so muted descendants turn subtle in both themes. Do this with a variable override in `stylex.create`, never with a `createTheme` (that re-emits every colour of the group and undoes dark mode).
- Every primitive ships `<Name>.fixtures.tsx`, rendered by `apps/gallery`. A fixture frame can ask the screenshot runner to `hover`, `press` or `focus` an element first, so hover, pressed and focused states are reviewed like any other.

## 1. Icon

Lucide wrapper. Takes the icon component (`icon={Hash}`), not a name, so only used icons are bundled. `size` 11–18 (default 16), `dim` for the 0.75 tab icon, optional `label` (otherwise hidden from assistive technology). Stroke is `currentColor`.

## 2. Button

One component for every clickable control with a label. Radius, text size and icon size follow from the size; there are no overrides, so views cannot drift off the design.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `primary` (`--hl` / `--hl-fg`), `secondary`, `outline` (1px `--border-strong`, hover `--border-strongest` + `--surface-hover`), `ghost`, `raised` (surface + `--card-ring` + `--shadow-sm`; send-check primary), `filter` (quick filter: always 28px, radius 7, 13px text, muted until hovered; `pressed` = `--secondary-default` + 600) | |
| `size` | `xs` 22, `sm` 28, `md` 30, `lg` 32, `xl` 34, `2xl` 36 | Radius 6 / 6 / 7 / 8 / 8 / 8, text 11.5 / 12.5 / 13 and icon 12 / 13 / 14 derive from the size |
| `tone` | `default`, `subtle`, `muted` | Text colour for ghost and outline; hover turns default |
| `iconStart`, `iconEnd` | lucide icon | |
| `kbd` | string | Trailing mono hint ("↵", "⌘J") |
| `pressed` | boolean | Toggle state (Pin, filters); sets `aria-pressed` |
| `dimmed` | boolean | opacity .4, still focusable, `aria-disabled` (Send with empty draft) |
| `disabled` | boolean | Same look as dimmed; no press scale |

Covers: quick filters, status chips, Resolve (row and header), Group into topic, Dismiss, Not yet, Discard/Send, card actions, suggestion chips, Stop ignoring, Add, Ignore, Mark read, Undo. Sidebar nav items are `NavItem`.

## 2a. NavItem

The sidebar navigation item (All topics, For you, Juno): 32px, full width, radius 7, 15px `icon` then the label, ghost until hovered, `--secondary-default` when `active` (sets `aria-current="page"`). `trailing` takes the count Chip, `kbd` the "⌘J" hint. Navigates on mouse down through `onSelect` like rows and tabs; `onContextMenu` for the right button.

## 3. IconButton

Button with only an icon. `label` is required and doubles as the tooltip (`noTooltip` turns the tooltip off).

| Prop | Values |
| --- | --- |
| `size` | 20, 22, 26, 28, 30, 32, 36 |
| `radius` | derived (4 for 20–22, 6 for 26–28, 8 for 30+), or `sm` (5, dismiss), `full` (attach, send) |
| `variant` | `ghost` (default), `secondary`, `primary` (send), `raised` |
| `tone` | `subtle` (default), `muted`, `default` for ghost |
| `icon`, `iconSize`, `pressed`, `dimmed` | as Button |

## 4. Avatar and AvatarStack

One `Avatar` component. `kind` `person` (round, initials, person colour), `channel` (square tile with one letter, `--secondary-default`), `group` (round, two initials). `size` 44, 36, 32, 28, 24, 20, 18 sets the initials size. `hue` picks one of the eight person colours (`hueNames`); background and foreground are mixed from it. `name` gives the accessible name; without it the avatar is decorative. `ring` takes the surface the avatar sits on (`background` | `subtle` | `surface`) and adds a 1.5px ring in that colour.

`AvatarStack`: `people[]` (`id`, `initials`, `name`, `hue`), `max` (4), `size` (18), overlap −4. Each avatar shows one initial (two would be clipped by the next avatar) and a ring in the colour of `surface` (`subtle` by default, the sidebar; `background` or `surface` elsewhere) so the overlap reads as a cut.

## 5. Chip

Small inline label. Replaces tags, count badges, status chips, decision chips, summary chips, confidence badge, scope chip, digest chips, the stealth pill.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `outline` (Main), `filled` (Reopened, Open, Digest), `strong` (`--secondary-active`; unread count), `soft` (`--hl-soft` + inset ring; @), `accent` (`--hl`; Now, @ in Browse), `success` (resolved tint), `quiet` (transparent, muted), `surface` (`--surface-hover`), `dashed` (stealth pill) | |
| `size` | 18 (tag), 20 (badge), 22 (status), 24 (summary, reaction), 26 (scope), 28 (digest time) | Text 11 / 11 / 12 / 12 / 12.5 / 13 |
| `icon`, `iconSize` | 11–13 | sparkle in the confidence badge |
| `numeric` | boolean | tabular figures |
| `onRemove`, `removeLabel` | | Adds a 20×20 close IconButton |
| `interactive`, `pressed` | | Renders a toggle `button` (reaction chips: 1px `--border-default`, pressed = `--hl-soft` + `--hl-ring` border) |
| `title` | tooltip | |

## 6. ContextPill

The tinted "where" pill. It draws what it is given and knows nothing about conversation kinds: `tint` `public` | `private` | `dm` (the three tints in the tokens; group DMs use `dm`), `icon` (`Hash`, `Lock`, `User`, `Users`), `name` without "#", `kindLabel` ("Public channel", also the tooltip) shown after a dot at 400 when `showKind` is set; `size` 22 (card), 26 (header), 28 (To field). The kind → tint, icon and label mapping is a `@juno/domain` rule applied by the view.

## 7. Kbd

Keyboard hint in the mono face. `look` `plain` (muted text: "⌘J", "↵") or `key` (keycap: "esc"). `inherit` uses the surrounding colour at 0.75 (inside the toast Undo).

## 8. Text

Typography. `variant` maps to the five variables of a type role in tokens: `sectionLabel`, `tableHeader`, `divider`, `tag`, `tagSmall`, `meta`, `pill`, `buttonSmall`, `ui`, `preview`, `bodySmall`, `body`, `rowTitle`, `messageName`, `heading`, `topicTitle`, `pageTitle`, `pageTitleCompact`, `display`, `emptyTitle`, `kbd`, `code`. Props: `tone` (`inherit` | `default` | `subtle` | `muted` | `accent` | `danger`), `weight` override, `truncate`, `clamp` (1–3), `numeric`, `selectable`, `as`, `sx` (layout styles only; the type rejects colour and font properties). ARIA `role` passes through. Block variants default to a block tag (`p`, `h1`, `h2`, `pre`).

## 9. Surface, Divider, LabelledRule

`Surface` `kind`: `card` (surface + `--card-ring`, radius 10, padding 14), `popover` (`--pop-shadow`, radius 13, padding 6), `toolbar` (radius 9), `group` (card with no padding, clips children), `inset` (`--background` + 1px `--border-default`, radius 8), `field` (the composer frame: surface + 1px `--input-border`, focus colour and 1px ring on `:focus-within`, radius 12), `toast` (ink on paper, `--shadow-lg`). `padding` `none` | `xs` 4 | `sm` 6 | `md` 12 | `lg` 14 and `radius` override the defaults. Floating kinds carry a transparent 1px border so a ring never changes layout.

`Divider`: 1px, `tone` `default` | `subtle`, `vertical`, `inset`. `LabelledRule`: the "3 NEW" divider, `label` + rule in `--hl` / `--hl-rule` (or `muted`); fills its row.

## 10. Popover and OptionList

`Popover`: renders `anchor` in place and, when `open`, a `popover` Surface next to it. `placement` (`bottom-start` | `bottom-end` | `top-start` | `top-end`), `width` (`menu` 236, `account` 248, `browse` 300, `mention` 280, `anchor`), `maxHeight` (`popover` 400, `picker` 300), `layer` (`mention` | `picker` | `menu` | `context`), `role`, `label`. Closes on Esc, outside pointer-down and focus leaving (`closeOnBlur`). Scroll is contained. No animation.

Menus are not a separate primitive: an in-app menu (the account menu) is an `OptionList` with `role="menu"` inside a `Popover`; its rows become `menuitem`s. In a `listbox`, rows are `option`s and `aria-selected` is the real selection only (the keyboard highlight is `aria-activedescendant`). Real context menus are native.

`OptionList` (`role` `listbox` | `menu`, `activeId` → `aria-activedescendant`, `focusable` to handle keys on the list itself) + `OptionRow` (`id`, `leading`, `label`, `sub` with `subPlacement` `end` | `inline` | `below`, `trailing`, `active`, `selected`, `disabled`, `size` 30 | 32 | 34 | 55, `onSelect`, `onActivate` on pointer move, `onContextMenu`). Rows select on mouse down and keep focus in the owning input. `OptionGroupLabel` (PEOPLE, RECENT), `OptionSeparator`, `OptionHeader` (avatar + two lines). `useOptionListKeys({ ids, activeId, onActiveChange, onSelect, onClose, selectKeys })` returns the key handler for ArrowUp/Down (wrapping), Home/End, Enter (and Tab for suggestions), Esc.

## 11. Tabs

`TabStrip` (44px drag region, full width, bottom border, `trailing` slot for the new-tab IconButton) + `Tab` (`icon` at 0.75, `label`, `active`, `onSelect`, `onClose` with `closeLabel`, `onContextMenu`; 35px, radius 8 8 0 0, flex 0 1 230, min 72; the active tab's bottom border is the page colour so it merges).

## 12. Fields

`TextField`: 1px `--input-border`, surface background, focus shown on the container (`--focus-ring` border and 1px ring). `size` 30, 32, 34, 36, 44 (radius 7 / 7 / 8 / 8 / 10). `leadingIcon` (search), `leading` slot (the "To" label and a ContextPill), `trailing`, `width` (`full` | `search` 260 | `keyword` 160), `text`, `label` (required without a visible label), `invalid` (danger border, `aria-invalid`).

`Textarea`: `variant` `plain` (bordered, 6 rows, resize vertical), `inline` (composer: no border, 22px line height, grows with `field-sizing: content` to `maxHeight` `composer` 194 or `assistant` 160 then scrolls; no layout is read on a keystroke), `card` (send card, `--background`, 2 rows).

`Select`: native `<select>` styled like a 30 or 32px field with a muted chevron; `options[]`.

`Checkbox`: native 15px with `accent-color: --foreground-default`; `label`, `description`, `size` `md` (13.5) | `lg` (14).

`Slider`: `<input type="range">` with a 4px track (`--secondary-active`, filled part in `--foreground-default`), 14px ink thumb with a 2px `--background` ring; `min`, `max`, `step`, `value`, `label`, `valueText`, `disabled`.

`Segmented`: track padding 2 on `--surface-hover`, radius 7; segments 24px radius 5, 12/500, selected = `--surface-raised` + `--shadow-sm` (raised in both themes). Radio group with arrow keys. `options[]`, `value`, `onChange`, `label`, `disabled`.

The composer is a feature component: `Surface field` + slots + `IconButton` + `Textarea inline` + `IconButton`. The buttons sit at the end of the row with a bottom margin of (40 − 28) / 2 so they centre on the single line and on the last line once the text has grown.

## 13. ListRow

Generic row for settings groups, logs and tables: `minHeight` 44 | 48 | 52, `padding` `settings` | `table` | `log`, bottom `divider` (default on), `leading`, `trailing`, children. With `onSelect` it is a focusable `role="button"` with a hover background and radius 8 (`selected` for the current row; muted text inside a selected row renders subtle). Rows set `contain: content`. Sidebar topic rows and All topics rows are feature components built on this.

## 14. Toast

`Toast`: `toast` Surface, 13px text (one line, ellipsis), optional `action` (`label`, `kbd`, `onAction`) drawn as a 26px translucent button. `ToastRegion` pins its child bottom-left (16/16, z 45). Lifetimes and replacement are the owner's job.

## 15. EmptyState

Centered `title`, `body` (why it is empty) and one `action`. `variant` `list` (14/500 title) or `workspace` (serif 30 subtle). `padding` `list` (48 16) or `page` (48).

## 16. Page, PageHeader, Section

`Page`: scrolling page with a centred column, `width` `narrow` 680 | `default` 720 | `settings` 760 | `wide` 880, `padding` `page` (40 32 72) | `form` (56 32 64). `PageHeader`: serif `title` (`size` `compact` for the 32px All topics title), `subtitle`, `trailing` slot. `Section`: 15/600 `heading` + 13 muted `sub` + children (usually a `Surface group`).

## 17. CodeBlock

Mono 12.5 lh 1.6 inside a `Surface inset`, pre-wrap, max-height 150 with contained scroll, selectable. For you prompt only.

## 18. Card

`Surface card` with a meta header (`kindIcon` + `kind`, `·`, `sourceIcon` + `source`, `onDismiss` 22px IconButton), `title` (15/600), `body` (13.5 subtle), `children` (prompt block, reply options) and `actions` (wrapping Button row). Used by For you cards and assistant cards; message-level cards (catch-up, grouping, settled) use `Surface card` directly.

---

## What is not a primitive

Feature components that compose the above and hold app logic: `Sidebar`, `TopicRow`, `TopicHeader`, `MessageList` / `Message` / `Bubble`, `MessageText` (token segmenting into Chips), `HoverToolbar`, `Composer` (with `SendCheckBar`, `AudienceWarning`, `MentionSuggest`), `CommandPalette`, `AllTopicsTable`, `ForYouCard`, `JunoThread` (+ `SendCard`, `TopicsCard`, `ResolveCard`), `NotificationRules`, `IgnoreList`, `NewMessageForm`, `ContextMenu` (native bridge).

## Count

19 primitives: Icon, Button, NavItem, IconButton, Avatar (+AvatarStack), Chip, ContextPill, Kbd, Text, Surface (+Divider, LabelledRule), Popover/OptionList, Tabs, Fields (TextField, Textarea, Select, Checkbox, Slider, Segmented), ListRow, Toast, EmptyState, Page/PageHeader/Section, CodeBlock, Card.

Differences from the first proposal: Button's accent variant is called `primary`; Tile and Avatar are one component; Menu/MenuItem were folded into OptionList (same row anatomy, one keyboard model); PageHeader got a `Page` container for the width and padding instead of setting them itself; `Icon` takes a component rather than a name.
