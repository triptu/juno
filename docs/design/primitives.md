# Juno UI primitives

The dumb, reusable primitives in `packages/ui`, derived from the repeated patterns in the design (`inventory.md`). Each is a thin React + StyleX component with no data fetching and no app state. Feature components (TopicRow, MessageList, Palette, …) compose these. The list is deliberately short; add a primitive only when a third use appears.

Shared conventions for every primitive (details in `packages/ui/README.md`):

- No `cursor: pointer`. Hover styles only under `@media (hover: hover)`.
- Press feedback `scale(0.96)` at 150ms `--ease-out`, suppressed when disabled. Entrances (toast, popover, empty state) are 240ms, pops (a toggle filling, a reaction landing) 220ms with the spring; everything collapses under reduced motion through the tokens (`tokens.md` §8).
- Icons are Phosphor: bold at 14px and below, regular at 15 and above, `fill` for an active or selected state, `duotone` only for the deliberate friendly spots (Juno nav item, AI sparkles, card kinds, illustrations).
- Visible focus ring (`--focus-ring`, 2px) only on `:focus-visible`.
- Icon-only controls require an accessible name (`label`).
- Sizes, colours, radii and durations come from tokens; no literal values in components.
- `user-select: none` by default; text-bearing primitives (Text `selectable`, TextField, Textarea, CodeBlock) opt in.
- Things that navigate (ListRow with `onSelect`, Tab, OptionRow, NavItem) activate on `pointerdown` with the primary button; ⌘ passes through for "open in new tab", right-click goes to `onContextMenu`, Enter/Space work, nested controls are ignored. No transition on their background.
- Muted text never sits on a secondary fill: a container with such a fill (ListRow `selected`) sets `--foreground-muted` to the subtle value on itself, so muted descendants turn subtle in both themes. Do this with a variable override in `stylex.create`, never with a `createTheme` (that re-emits every colour of the group and undoes dark mode).
- Every primitive ships `<Name>.fixtures.tsx`, rendered by `apps/gallery`, with its states grouped under headings and only states the component can reach. A fixture frame can ask the screenshot runner to `hover`, `press` or `focus` an element first, so hover, pressed and focused states are reviewed like any other.

## 1. Icon

Phosphor wrapper. Takes the icon component (`icon={Hash}`, imported from `@phosphor-icons/react/dist/icons/Hash`), not a name, so only used icons are bundled. `size` 12 | 13 | 14 | 15 | 16 | 18 | 20 (default 16); `weight` `regular` | `bold` | `fill` | `duotone`, defaulting to bold at 14 and below and regular at 15 and above, so call sites only name `fill` and `duotone`; `active` is shorthand for `weight="fill"` (the outline/fill pair of a toggle); `dim` for the 0.75 tab icon; optional `label` (otherwise hidden from assistive technology). Drawn in `currentColor`. The Lucide name mapping is in `friendly-layer.md` §2.3.

## 2. Button

One component for every clickable control with a label. Radius, text size and icon size follow from the size; there are no overrides, so views cannot drift off the design.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `primary` (`--hl` / `--hl-fg`), `secondary`, `outline` (1px `--border-strong`, hover `--border-strongest` + `--surface-hover`), `ghost`, `raised` (surface + 1px `--border-default` + `--shadow-sm`; send-check primary), `filter` (quick filter: always 28px, radius 12, 13px text, muted until hovered; `pressed` = `--secondary-default` fill and the default text colour; the weight stays 500 so the width never changes) | |
| `size` | `xs` 22, `sm` 28, `md` 30, `lg` 32, `xl` 34, `2xl` 36 | Radius pill / 8 / 12 / pill / pill / pill (the 22px row Resolve is a label-sized control and the 32px and taller buttons are pills; 28 and 30 stay rounded rectangles so they nest in cards and toolbars), text 12 / 13 / 13.5 and icon 13 / 14 / 16 derive from the size |
| `tone` | `default`, `subtle`, `muted` | Text colour for ghost and outline; hover turns default |
| `iconStart`, `iconEnd` | Phosphor icon | Weight by size; `iconWeight` overrides (`fill` for a check that has landed) |
| `kbd` | string | Trailing mono hint ("↵", "⌘J") |
| `pressed` | boolean | Toggle state (Pin, filters); sets `aria-pressed` |
| `dimmed` | boolean | opacity .4, still focusable, `aria-disabled` (Send with empty draft) |
| `disabled` | boolean | Same look as dimmed; no press scale |

Covers: quick filters, status chips, Resolve (row and header), Not yet, Discard/Send, card actions, suggestion chips, Stop ignoring, Add, Ignore, Mark read, Undo. Sidebar nav items are `NavItem`.

## 2a. NavItem

The sidebar navigation item (Home, All topics, Juno): 32px, full width, radius 12, 16px `icon` then the label, ghost until hovered; when `active` (sets `aria-current="page"`) it takes the accent's nav tint `--hl-nav`, accent text `--hl-text`, weight 600 and a filled icon (the ink accent keeps the plain `--secondary-default`). `iconWeight` overrides the outline/fill pair; the Juno item passes `duotone` so it stays marked as the one AI surface whether or not it is open. `trailing` takes the count Chip, `kbd` the "⌘J" hint. Navigates on mouse down through `onSelect` like rows and tabs; `onContextMenu` for the right button. Never animates.

## 3. IconButton

Button with only an icon. `label` is required and doubles as the tooltip (`noTooltip` turns the tooltip off).

| Prop | Values |
| --- | --- |
| `size` | 20, 22, 26, 28, 30, 32, 36 |
| `radius` | derived (4 for 20–22, 6 for 26, 12 for 28 (the hover-toolbar button), 8 for 30+), or `sm` (5, dismiss), `full` (attach, send) |

`EmojiButton`: the 28px hover-toolbar button whose icon is an emoji (`emoji` as text, or `src` for a custom emoji's image, with `emoji` as the alt), radius 12, the same feedback as `IconButton`. Needs a `label` ("React 👍").
| `variant` | `ghost` (default), `secondary`, `primary` (send), `raised` |
| `tone` | `subtle` (default), `muted`, `default` for ghost |
| `icon`, `iconSize`, `iconWeight`, `dimmed` | as Button. Icon 12 / 12 / 13 / 18 / 18 / 18 / 20 by size; the send arrow passes `iconWeight="bold"`, attach `iconSize={20}` |
| `pressed` | Toggle state (subscribe, pin): `aria-pressed` and the filled icon. Both icons stay in the DOM; the fill scales 0.8 → 1 with the spring over `--duration-pop` and cross-fades in, off just cross-fades over `--duration-fast` |

## 4. Avatar and AvatarStack

`Avatar` is a person or a group, always round. `kind` `person` (initials) or `group` (two initials). `size` 44, 36, 32, 28, 24, 20, 18 sets the initials size. `hue` picks one of the eight person colours (`hueNames`; `hueForId(slackId)` picks one deterministically); background and foreground are mixed from it. `src` is the Slack profile photo: the box is reserved at `size` before the bytes arrive, the photo fades in over the initials (`--duration-fast`, nothing under reduced motion), and if it fails the initials stay, so nothing ever moves. `name` gives the accessible name; without it the avatar is decorative. `ring` takes the surface the avatar sits on (`background` | `subtle` | `surface`) and adds a 1.5px ring in that colour.

Channels are `ChannelIcon` (section 4a).

`AvatarStack`: `people[]` (`id`, `initials`, `name`, `hue`), `max` (4), `size` (18), overlap −4. Each avatar shows one initial (two would be clipped by the next avatar) and a ring in the colour of `surface` (`subtle` by default, the sidebar; `background` or `surface` elsewhere) so the overlap reads as a cut.

## 4a. ChannelIcon and Swatch

`ChannelIcon` is the square tile for a channel: a chosen Phosphor icon, or the first letter of `name`, on a chosen colour, in the same hue mix as avatars so tiles and initials sit together in a row. `icon` is one of `channelIconNames` (24 plain objects that read at 16px: hash, megaphone, chats, rocket, code, bug, wrench, flask, shield, lightning, globe, compass, flag, star, heart, leaf, coffee, gift, trophy, book, briefcase, calendar, camera, truck; `channelIcons` maps a name to its component), `color` one of `channelColorNames` (the eight person hues). `defaultChannelLook(id)` is what a channel gets before anyone changes it: a colour hashed from its id and no icon, so a list of untouched channels still tells them apart by letter. `size` as Avatar; radius 16 / 12 / 12 / 8 / 7 / 6 / 5 by size. `label` for the accessible name when the channel name is not visible beside it. The choice is client-only (SPEC §3) and the view that changes it is `ChannelIconPicker` in `@juno/views`.

`Swatch`: a round 24px colour choice, a bold check and a ring when `selected` (`aria-pressed`). Required `label`. `hue` draws a person or channel colour in the avatar mix (the channel picker); `accent` draws an accent's solid fill from the `accentSwatches` tokens (the appearance settings). The accent picker uses it too.

`DayToggles`: seven 28px round toggle buttons, Monday first ("M T W T F S S", each named by its day, `aria-pressed`), in a group named by `label`. An on day is filled with `--secondary-default`; an off day is muted text. `days` uses 0 for Sunday, as `Date.getDay`. The Notifications page's hours rows use it.

## 5. Chip

Small inline label. Replaces tags, count badges, status chips, decision chips, summary chips, confidence badge, scope chip.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `outline` (Main), `filled` (Reopened, Open, Digest, #channel), `strong` (`--secondary-active`; unread count), `soft` (`--hl-soft` + inset ring; @), `accent` (`--hl`; Now, @ in Browse, @you), `success` (resolved tint), `quiet` (transparent, muted), `surface` (`--surface-hover`), `person` (the inline @mention: `hue` mixed 16% into the surface and 40% into the text, weight 600; `hue` as Avatar) | Every chip is a pill (`--radius-tag`) |
| `size` | 18 (tag), 20 (badge), 22 (status), 24 (summary, reaction), 26 (scope), 28 (notification setting tag), `inline` (follows the surrounding line; padding 0 5) | Text 11 / 11 / 12 / 12 / 12.5 / 13 / inherited |
| `icon`, `iconSize` | 12–13, bold | sparkle in the confidence badge |
| `numeric` | boolean | tabular figures |
| `onRemove`, `removeLabel` | | Adds a 20×20 close IconButton (12px bold X) |
| `interactive`, `pressed`, `pop` | | Renders a toggle `button` (reaction chips: 1px `--border-default`, pressed = `--hl-soft` + `--hl-ring` border and the count in `--foreground-default`). `pop` plays the spring once (1 → 1.12 → 1 over `--duration-pop`); set it only when the toggle was the user's own action |
| `title` | tooltip | |

## 6. ContextPill

The tinted "where" pill, fully round (`--radius-pill`). It draws what it is given and knows nothing about conversation kinds: `tint` `public` | `private` | `dm` (the three tints in the tokens; group DMs use `dm`), `icon` (`Hash`, `Lock`, `User`, `Users`, bold at 12 / 14 / 14), `name` without "#", `kindLabel` ("Public channel", also the tooltip) shown after a dot at 400 when `showKind` is set (the To field and cards; the header shows the name only, with the kind in the tooltip and the accessible name); `size` 22 (card), 24 (header: 12.5px, icon 13), 26 (default), 28 (To field). With `onClick` the pill is a button (the header's: narrow the sidebar to the channel) and `label` is its accessible name, which carries the kind ("eng, public channel. Show in sidebar."). The kind → tint, icon and label mapping is a `@juno/domain` rule applied by the view.

## 7. Kbd

Keyboard hint in the mono face. `look` `plain` (muted text: "⌘J", "↵") or `key` (keycap: "esc"). `inherit` uses the surrounding colour at 0.75 (inside the toast Undo).

## 8. Text

Typography. `variant` maps to the five variables of a type role in tokens: `sectionLabel`, `tableHeader`, `divider`, `tag`, `tagSmall`, `meta`, `pill`, `buttonSmall`, `ui`, `preview`, `bodySmall`, `body`, `rowTitle`, `messageName`, `heading`, `topicTitle`, `pageTitle`, `pageTitleCompact`, `display`, `emptyTitle`, `kbd`, `code`. Props: `tone` (`inherit` | `default` | `subtle` | `muted` | `accent` | `danger`), `weight` override, `truncate`, `clamp` (1–3), `numeric`, `selectable`, `as`, `sx` (layout styles only; the type rejects colour and font properties). ARIA `role` passes through. Block variants default to a block tag (`p`, `h1`, `h2`, `pre`).

## 9. Surface, Divider, LabelledRule

`Surface` `kind`: `card` (surface + `--card-ring`, radius 20, padding 14), `popover` (`--pop-shadow`, radius 13, padding 6), `toolbar` (`--pop-shadow`, radius 16), `group` (card with no padding, clips children), `inset` (`--background` + 1px `--border-default`, radius 8), `field` (the composer frame: surface + 1px `--input-border` that turns `--focus-ring` on `:focus-within`, with no extra ring, radius 20, a pill at its single-line height), `toast` (ink on paper, `--shadow-lg`, radius 14), `island` (the page header's islands: `--surface-default`, `--card-ring`, `--radius-pill`, a flex row with a 2px gap, the inset of 3 that is left around a 28px control, height `--header-island-height`; inventory §5). `--card-ring` and `--pop-shadow` are wide soft shadows with no ring. `padding` `none` | `xs` 4 | `sm` 6 | `md` 12 | `lg` 14 and `radius` override the defaults. Floating kinds carry a transparent 1px border so a ring never changes layout.

`Divider`: 1px, `tone` `default` | `subtle`, `vertical`, `inset`. `LabelledRule`: the "3 new" divider, `label` + rule in `--hl` / `--hl-rule` (or `muted`); fills its row.

`HeaderBand`: the static band behind a page header's islands (`--header-band` tall, solid to `--header-band-solid`, then a fade), `aria-hidden`, no pointer events. Used by the topic header, the Juno tab and the Juno panel.

## 10. Popover and OptionList

`Popover`: renders `anchor` in place and, when `open`, a `popover` Surface next to it. `placement` (`bottom-start` | `bottom-end` | `top-start` | `top-end`), `width` (`menu` 236, `account` 248, `browse` 300, `mention` 280, `anchor`), `maxHeight` (`popover` 400, `picker` 300), `layer` (`mention` | `picker` | `menu` | `context`), `role`, `label`. Closes on Esc, outside pointer-down and focus leaving (`closeOnBlur`). Scroll is contained. Appears with opacity and a 0.98 → 1 scale from the anchor corner over `--duration-appear`; closing is instant (the panel unmounts).

Menus are not a separate primitive: an in-app menu (the account menu) is an `OptionList` with `role="menu"` inside a `Popover`; its rows become `menuitem`s. In a `listbox`, rows are `option`s and `aria-selected` is the real selection only (the keyboard highlight is `aria-activedescendant`). Real context menus are native.

`OptionList` (`role` `listbox` | `menu`, `activeId` → `aria-activedescendant`, `focusable` to handle keys on the list itself) + `OptionRow` (`id`, `leading`, `label`, `sub` with `subPlacement` `end` | `inline` | `below`, `trailing`, `active`, `selected`, `disabled`, `size` 30 | 32 | 34 | 55, `onSelect`, `onActivate` on pointer move, `onContextMenu`). Rows select on mouse down and keep focus in the owning input. `OptionGroupLabel` (PEOPLE, RECENT), `OptionSeparator`, `OptionHeader` (avatar + two lines). `useOptionListKeys({ ids, activeId, onActiveChange, onSelect, onClose, selectKeys })` returns the key handler for ArrowUp/Down (wrapping), Home/End, Enter (and Tab for suggestions), Esc.

## 10a. ScrollArea

`ScrollArea`: a vertical scroll container (`overflow-y: auto`, contained overscroll) with `scrollbar` (`always` | `hover`), `as`, a `ref` to the scroll element (the message list's container reads and sets the position through it) and a layout-only `sx`. The scrollbar is the 10px classic bar from `global.css` in both modes, so the gutter never changes size. `hover` sets a `--scrollbar-thumb` variable to transparent and to `--border-strong` under `:hover` (hover-capable pointers only); the `::-webkit-scrollbar-thumb` reads it. The track is transparent always. Keyboard and trackpad scrolling are the browser's. `underHeader` is for a list that runs under a page header's islands: it adds the `--header-inset` top padding, `scroll-padding-top: --header-band` and a `--header-band` top margin on the scrollbar track, all in CSS. The sidebar topic list and the message list are `ScrollArea scrollbar="hover"`; `Page`, `Popover` and `CodeBlock` keep the always-on bar for now.

## 11. Tabs

`TabStrip` (44px drag region, full width, bottom border, `trailing` slot for the new-tab IconButton) + `Tab` (`icon` at 0.75, or `leading` to fill the fixed 15px icon slot with a topic's art, `label`, `active`, `onSelect`, `onClose` with `closeLabel`, `onContextMenu`; 35px, radius 8 8 0 0, flex 0 1 230, min 72; the active tab's bottom border is the page colour so it merges).

## 12. Fields

`TextField`: 1px `--input-border`, surface background, focus shown on the container (the border turns `--focus-ring`; no extra ring, since a field always holding focus, like the Juno panel's composer, read heavy with two). `size` 30, 32, 34, 36, 44 (radius 7 / 7 / 8 / 8 / 10). `leadingIcon` (search), `leading` slot (the "To" label and a ContextPill), `trailing`, `width` (`full` | `search` 260 | `keyword` 160), `text`, `label` (required without a visible label), `invalid` (danger border, `aria-invalid`).

`Textarea`: `variant` `inline` (composer: no border, 22px line height, grows with `field-sizing: content` to `maxHeight` `composer` 194 or `assistant` 160 then scrolls; no layout is read on a keystroke), `card` (send card, `--background`, 2 rows).

`Select`: native `<select>` styled like a 30 or 32px field with a muted chevron; `options[]`.

`Checkbox`: native 15px with `accent-color: --foreground-default`; `label`, `description`, `size` `md` (13.5) | `lg` (14).

`Slider`: `<input type="range">` with a 4px track (`--secondary-active`, filled part in `--foreground-default`), 14px ink thumb with a 2px `--background` ring; `min`, `max`, `step`, `value`, `label`, `valueText`, `disabled`.

`Segmented`: track padding 2 on `--surface-hover`, radius 7; segments 24px radius 5, 12/500, selected = `--surface-raised` + `--shadow-sm` (raised in both themes). Radio group with arrow keys. `options[]`, `value`, `onChange`, `label`, `disabled`.

The composer is a feature component: `Surface field` + slots + `IconButton` + `Textarea inline` + `IconButton`. The buttons sit at the end of the row with a bottom margin of (40 − 28) / 2 so they centre on the single line and on the last line once the text has grown.

## 13. ListRow

Generic row for settings groups, logs and tables: `minHeight` 44 | 48 | 52, `padding` `settings` (8 14, the same inset at both ends) | `table` | `log`, bottom `divider` (default on), `leading`, `trailing`, children. With `onSelect` it is a focusable `role="button"` with a hover background and radius 16 (`selected` for the current row; muted text inside a selected row renders subtle). Rows set `contain: content`. Sidebar topic rows and All topics rows are feature components built on this.

## 14. Toast

`Toast`: `toast` Surface (radius 14), optional filled `icon` in `--toast-success` (the check in the resolve toast), 13px text (one line, ellipsis), optional `action` (`label`, `kbd`, `onAction`) drawn as a 26px translucent pill. Rises in 8px with opacity over `--duration-appear`. `ToastRegion` pins its child bottom-left (16/16, z 45). Lifetimes, the exit fade (`--duration-exit`) and replacement (key the toast so a replacement cross-fades rather than sliding again) are the owner's job.

## 15. EmptyState

Centered `illustration` (optional; an `IllustrationName`, 96 wide in `list`, 120 in `workspace`, 14px above the title), `title`, `body` (why it is empty) and one `action`. `variant` `list` (14/500 title) or `workspace` (serif 30 subtle). `padding` `list` (48 16) or `page` (48). The parts enter staggered 80ms apart (opacity and a 6px rise) once, when the state mounts; the owner passes `enter={false}` when the state was visible less than a second ago so a filter change just shows it. Copy for each empty state is in `friendly-layer.md` §7.

## 15a. Illustration and Logo

`Illustration` `name`: `caught-up` (the seated j with a tablet on its lap and a check; Unread filter with nothing unread), `nothing-here` (a tray with two faded rows; a filter hides everything, All topics and Browse with no match), `nothing-open` (a blank tablet with two reply dots; no tabs), `no-results` (a magnifying glass over two rows; ⌘K), `juno` (the seated j alone on a warm disc; the Juno chat empty state). `size` `list` 96 | `workspace` 120 | `figure` 40. One colour (`--foreground-subtle` through `currentColor`), stroke 4 on a 104 by 72 grid, round caps, filled dots, one `--warm-soft` layer. Decorative; the title says what it means.

`Logo`: the laptop-two mark in `currentColor`. `size` 16 | 18 | 20 | 24 | 28 | 32 | 40 | 44; `label` ("Juno") when it is not decorative. The sign-in page shows it at 40; the assistant's avatar is 28.

## 16. Page, PageHeader, Section

`Page`: scrolling page with a centred column, `width` `narrow` 680 | `default` 720 | `settings` 760 (every settings page), padding 40 32 72. The scroller keeps a stable scrollbar gutter, so the column does not move when the page starts or stops overflowing. `PageHeader`: serif `title` (`size` `compact` for the 32px All topics title), `subtitle`, `trailing` slot. `Section`: 15/600 `heading` + 13 muted `sub` + children (usually a `Surface group`).

## 17. CodeBlock

Mono 12.5 lh 1.6 inside a `Surface inset`, pre-wrap, max-height 150 with contained scroll, selectable. Code in Juno cards.

## 18. Card

`Surface card` with a meta header (`kindIcon` + `kind`, `·`, `sourceIcon` + `source`, `onDismiss` 22px IconButton), `title` (15/600), `body` (13.5 subtle), `children` (prompt block, reply options) and `actions` (wrapping Button row). Used by assistant cards (For you, its first user, is removed); the settled hint uses `Surface card` directly.

---

## What is not a primitive

Feature components that compose the above and hold app logic: `Sidebar`, `TopicRow`, `TopicHeader`, `MessageList` / `Message` / `Bubble`, `MessageText` (token segmenting into Chips), `HoverToolbar`, `Composer` (with `SendCheckBar`, `AudienceWarning`, `MentionSuggest`), `CommandPalette`, `AllTopicsTable`, `ForYouCard`, `JunoThread` (+ `SendCard`, `TopicsCard`, `ResolveCard`), `NotificationRules`, `IgnoreList`, `NewMessageForm`, `ContextMenu` (native bridge).

## Count

23 primitives (Surface gains the `island` kind and `HeaderBand`): Icon, Button, NavItem, IconButton, Avatar (+AvatarStack, AvatarButton), ChannelIcon (+Swatch, DayToggles), Chip, ContextPill, Kbd, Text, Surface (+Divider, LabelledRule), Popover/OptionList, ScrollArea, Tabs, Fields (TextField, Textarea, Select, Checkbox, Slider, Segmented), ListRow, Toast, EmptyState, Illustration, Logo, Page/PageHeader/Section, CodeBlock, Card.

Differences from the first proposal: Button's accent variant is called `primary`; Tile and Avatar are one component; Menu/MenuItem were folded into OptionList (same row anatomy, one keyboard model); PageHeader got a `Page` container for the width and padding instead of setting them itself; `Icon` takes a component rather than a name.
