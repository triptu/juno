# Juno UI primitives

The dumb, reusable primitives in `packages/ui`, derived from the repeated patterns in the design (`inventory.md`). Each is a thin React + StyleX component with no data fetching and no app state. Feature components (TopicRow, MessageList, Palette, …) compose these. The list is deliberately short; add a primitive only when a third use appears.

Shared conventions for every primitive (details in `packages/ui/README.md`):

- No `cursor: pointer`. Hover styles only under `@media (hover: hover)`.
- Buttons stay still on press and toggle, with instant hover and pressed colours. No scale, translate, spring or transform transition. Toast and empty-state entrances use `--duration-appear`; menus and popovers never animate. Other motion collapses under reduced motion through the tokens (`tokens.md` §8).
- Menu and popover triggers open on primary mouse `pointerdown` through `menuTriggerHandlers` in `@juno/ui`; a second press toggles closed. The following click is ignored. The press focuses the trigger without a focus ring (`focusVisible: false`, after a blur when it still has a ring from a key), so the ring shows only when the menu was opened or closed from the keyboard. Keyboard Enter/Space/↓ and assistive clicks still open; right-click, and ctrl-click on the Mac, retain their context-menu behaviour. Custom popovers require a separate press to select; native menus keep system drag selection.
- A control that opens a menu or popover (`aria-expanded`) draws its hover fill while it is open, and its press draws that fill too, so hover, press and open are one colour and opening changes nothing. `Button` and `IconButton` take `expanded`, `AvatarButton` takes `open`; views that draw their own trigger (the header title, Home's pickers) follow the same rule. A toggle (`pressed`) is a state of its own and keeps its own fill; a trigger is not also a toggle. Each set's `Open` fixture group holds `<name>-hover`, `-press`, `-open` and `-open-hover`, and `apps/gallery/trigger-open.spec.ts` checks the four fills match in light and dark (decided 10-17).
- Icons are Phosphor: bold at 14px and below, regular at 15 and above, `fill` for an active or selected state, duotone only for the deliberate friendly spots (Juno nav item, AI sparkles, card kinds, illustrations), through the icons in `packages/ui/src/duotone.ts`.
- Visible focus ring (`--focus-ring`, 2px) only on `:focus-visible`. It must show whole: a box that clips (overflow other than visible, or paint containment) gives the controls at its edge `ringRoom` (`--focus-ring-room` of padding taken back by a negative margin; a fixed size adds the room), and a scroller passes `revealFocus` as its `onFocus` so a control half under its edge scrolls in whole when it takes keyboard focus (`PillRow`, `TabStrip`, `ScrollArea` and `Page` do). Items that fill a scroller edge to edge take the inset ring instead. A scroller that is not a Tab stop of its own (its rows are driven from a field) sets `tabIndex={-1}`, since Chromium makes a scroller with no focusable children a Tab stop.
- The ring is one style, `focusRing` from `@juno/ui`: `outside` (2px out, with its scroll margin) for controls, `inset` for rows and controls flush against others. Primitives and views spread it; nothing writes the outline by hand (decided 10-17; Home and the Juno chat views still had their own copies then).
- A widget that is one Tab stop (a toolbar, a radio group) keeps a roving tabindex and takes its keys from `moveFocus(event, items, { orientation, select })`: the arrows move to the next or previous visible item and wrap, Home and End go to the ends. `radioKeys` is that for a `role="radiogroup"` (every arrow moves and chooses), and `radioItem(checked, tabbable)` turns a `Button`, `IconButton` or `Swatch` into one of its radios: `role="radio"`, `aria-checked` in place of `aria-pressed`, and the chosen one in the Tab order.
- Icon-only controls require an accessible name (`label`).
- Sizes, colours, radii and durations come from tokens; no literal values in components.
- `user-select: none` by default; text-bearing primitives (Text `selectable`, TextField, Textarea, CodeBlock) opt in.
- Things that navigate (ListRow with `onSelect`, Tab, OptionRow, NavItem) activate on `pointerdown` with the primary button; ⌘ passes through for "open in new tab", right-click goes to `onContextMenu`, Enter/Space work, nested controls are ignored. No transition on their background.
- Muted text never sits on a secondary fill: a container with such a fill (ListRow `selected`) sets `--foreground-muted` to the subtle value on itself, so muted descendants turn subtle in both themes. Do this with a variable override in `stylex.create`, never with a `createTheme` (that re-emits every colour of the group and undoes dark mode).
- Every primitive ships `<Name>.fixtures.tsx`, rendered by `apps/gallery`, with its states grouped under headings and only states the component can reach. A fixture frame can ask the screenshot runner to `hover`, `press` or `focus` an element first, so hover, pressed and focused states are reviewed like any other.

## 1. Icon

Phosphor wrapper. Takes the icon component (`icon={Hash}`, imported from `@phosphor-icons/react/dist/icons/Hash`), not a name, so only used icons are bundled. `size` 12 | 13 | 14 | 15 | 16 | 18 | 20 (default 16); `weight` `regular` | `bold` | `fill`, defaulting to bold at 14 and below and regular at 15 and above, so call sites only name `fill`; duotone is not a weight but an icon from `duotone.ts` (`SparkleDuotone`), the only icons the desktop build keeps that weight for (`scripts/check-duotone.mjs` fails on it anywhere else); `active` is shorthand for `weight="fill"` (the outline/fill pair of a toggle); `dim` for the 0.75 tab icon; optional `label` (otherwise hidden from assistive technology); `evenBox` `both` | `block` draws an odd size (13, 15) in a box 1px larger, with half a pixel of room each side, because the browser puts an SVG's box on whole pixels and an odd icon centred in an even box would draw half a pixel low and right. `IconButton` passes `both` and `Button` passes `block`, so their icons sit on the button's centre line. Drawn in `currentColor`. The Lucide name mapping is in `friendly-layer.md` §2.3.

## 1a. Emoji

A text or image emoji in one square of its `size`: 14 (reaction chips and the message menu), 16 (quick-reaction pills and the reactions dialog), 20 (suggestions and the emoji picker) or 32 (the reactors card). An inline image uses `inline` and follows the surrounding text's one-em height. Text is set in `--font-emoji` with line-height 1. In Figtree's line box an emoji drew off the centre line, and its advance (1.28em in Apple Color Emoji) is wider than the emoji. The outer square therefore stays fixed while the glyph inside it takes the measured optical shift: 14 by `--emoji-14-shift` (up 0.5), 16 up 1, 20 down 0.5, 32 down 1. Images fill the same unshifted square, so a row's label never moves when an image replaces text. Hidden from assistive technology when the parent names it; an inline message image names itself. A `:name:` with no image is plain text, not an `Emoji`. `emoji-align.spec.ts` checks the suggestion rows, chips, pills, picker and card from screenshots.

## 2. Button

One component for every clickable control with a label. Radius, text size and icon size follow from the size; there are no overrides, so views cannot drift off the design.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `primary` (`--hl` / `--hl-fg`), `secondary`, `outline` (1px `--border-strong`, hover `--border-strongest` + `--surface-hover`), `ghost`, `raised` (surface + 1px `--border-default` + `--shadow-sm`; send-check primary), `filter` (quick filter: always 28px, radius 12, 13px text, muted until hovered; `pressed` = `--secondary-default` fill and the default text colour; the weight stays 500 so the width never changes) | |
| `size` | `xs` 22, `sm` 28, `md` 30, `lg` 32, `xl` 34, `2xl` 36 | Radius pill / 8 / 12 / pill / pill / pill (the 22px row Resolve is a label-sized control and the 32px and taller buttons are pills; 28 and 30 stay rounded rectangles so they nest in cards and toolbars), text 12 / 13 / 13.5 and icon 13 / 14 / 16 derive from the size |
| `tone` | `default`, `subtle`, `muted` | Text colour for ghost and outline; hover turns default |
| `iconStart`, `iconEnd` | Phosphor icon | Weight by size; `iconWeight` overrides (`fill` for a check that has landed) |
| `iconTint` | an accent name or `neutral` | Draws `iconStart` in that colour from the `iconTints` tokens, on hover and when pressed too (a sidebar view's icon) |
| `kbd` | string | Trailing mono hint ("↵", "⌘J") |
| `pressed` | boolean | Toggle state (Pin, filters); sets `aria-pressed` |
| `expanded` | boolean | Its menu or popover is showing; sets `aria-expanded` and holds the variant's hover fill (Show why) |
| `dimmed` | boolean | opacity .4, still focusable, `aria-disabled` (Send with empty draft) |
| `disabled` | boolean | Same look as dimmed; no pointer events |

Covers: quick filters, status chips, Resolve (row and header), Not yet, Discard/Send, card actions, suggestion chips, Stop ignoring, Add, Ignore, Mark read, Undo. Sidebar nav items are `NavItem`.

## 2a. NavItem

The sidebar navigation item (Juno; Settings' sections): 32px, full width, radius 12, 16px `icon` then the label, ghost until hovered; when `active` (sets `aria-current="page"`) it takes the accent's nav tint `--hl-nav`, accent text `--hl-text`, weight 600 and a filled icon (the ink accent keeps the plain `--secondary-default`). While a job runs the Juno item passes `SparkleDuotone`, which stays duotone whether or not it is open. `trailing` takes the count Chip, `kbd` the "⌘J" hint. Navigates on mouse down through `onSelect` like rows and tabs; `onContextMenu` for the right button; `onPrefetch` on pointer enter and focus, to warm the page it opens (performance.md 4.2). `compact` draws the icon alone in a 32px square, with a string label as its accessible name and tooltip and no `trailing` or `kbd` (Settings' rail). Never animates.

## 3. IconButton

Button with only an icon. `label` is required and doubles as the tooltip (`noTooltip` turns the tooltip off). `shortcut` ("⌘[") shows as keycaps in the tooltip and ends the accessible name ("Back ⌘["). `iconTint` colours the icon as on Button.

| Prop | Values |
| --- | --- |
| `size` | 20, 22, 24, 26, 28, 30, 32, 36 |
| `radius` | derived (4 for 20–22, round for 24 (the selection bar's button, with a 15px icon), 6 for 26, 12 for 28, 8 for 30+), or `sm` (5, dismiss), `full` (attach, send) |

`SmileyPlus`: More reactions' glyph, a smiley with a plus at its top right where its outline opens, drawn on Phosphor's 256 grid with its strokes (16 regular, 24 bold) and its props, so `Icon` draws it like any Phosphor icon. Phosphor has none.
| `variant` | `ghost` (default), `secondary`, `primary` (send), `raised`, `island` (a page header island's control: hover and open `--secondary-default`, pressed toggle `--secondary-hover`) |
| `tone` | `subtle` (default), `muted`, `default` for ghost |
| `icon`, `iconSize`, `iconWeight`, `dimmed` | as Button. Icon 12 / 12 / 13 / 18 / 18 / 18 / 20 by size; the send arrow passes `iconWeight="bold"`, attach `iconSize={20}` |
| `pressed` | Toggle state (subscribe, pin): `aria-pressed` and the filled icon. Both icons stay in the DOM and swap at once, with no motion |
| `expanded` | Its menu or popover is showing (⋯, the quick reactions +, About): `aria-expanded` and the variant's hover fill held still, ghost `--surface-hover`, island `--secondary-default`, secondary `--secondary-hover` |
| `current` | The button opens a page and that page is the current tab: `aria-current="page"`, the filled icon, and an active NavItem's `--hl-nav` fill and `--hl-text` colour (the sidebar title bar's All topics and Home) |

## 4. Avatar and AvatarStack

`Avatar` is a person or a group, always round. `kind` `person` (initials) or `group` (two initials). `size` 44, 36, 32, 28, 24, 20, 18 sets the initials size. `hue` picks one of the eight person colours (`hueNames`; `hueForId(slackId)` picks one deterministically); background and foreground are mixed from it. `src` is the Slack profile photo: the box is reserved at `size` before the bytes arrive, the photo is drawn over the initials as soon as it is decoded, with no fade, and if it fails the initials stay, so nothing ever moves. `name` gives the accessible name; without it the avatar is decorative. `ring` takes the surface the avatar sits on (`background` | `subtle` | `surface`) and adds a 1.5px ring in that colour.

`PresenceDot` marks whether Slack shows someone as active, on an avatar's bottom right corner. It is 10px, filled with `--presence-active` when active and hollow inside a `--foreground-muted` hairline when away. Its centre sits on the round photo's edge at 45° at any avatar size: it is inset `14.645%` of the box (that is (1 − 1/√2) / 2) less half the dot from the right and the bottom, so the owner's positioned box must be the avatar alone. Its 2px ring takes the colour of `surface`: `subtle` for the sidebar, `raised` for a popover, `row` and `rowSelected` on a sidebar row (active, or paused). With `paused`, a 14px snooze badge takes the dot's place: Slack's mark, a "z" breaking out of an open circle, 10px with 1.5px round strokes, inside the same ring, in `--presence-active` while active and `--foreground-default` while away; `inline` shows the 10px glyph alone in `currentColor` (green while active). `inline` is an 8px dot with no ring for a line of text (the topic header's DM pill), where away is a 1px `currentColor` ring. Screen readers skip it. `AvatarButton` takes `presence` (`active` | `away`) to draw it and to set its `aria-description`; the account menu's header uses it too.

Channels are `ChannelIcon` (section 4a).

`AvatarStack`: `people[]` (`id`, `initials`, `name`, `hue`), `max` (4), `size` (18), overlap −4. Each avatar shows one initial (two would be clipped by the next avatar) and a ring in the colour of `surface` (`subtle` by default, the sidebar; `background` or `surface` elsewhere) so the overlap reads as a cut.

`GroupAvatar` is a group DM's tile: `people[]` (as `AvatarStack`, two or more), `size` 44 (a sidebar row) or 16 (a tab icon), `name` for the accessible name. It draws two members in a diagonal pair: 28px members 16px apart in 44, 11px members 5px apart in 16, the back one at the top left masked out around the front one (a 2px gap in 44, 1px in 16). The cut is a mask, not a ring, so it reads on any fill (hover, selected) without knowing the surface. Members with a photo go first; a member without one shows their colour, with one initial at 44 and none at 16. Calmer than a 2×2 mosaic, which is four faces at a 44px size and unreadable at 16.

## 4a. ChannelIcon and Swatch

`ChannelIcon` is the square tile for a channel: a chosen Phosphor icon, or the first letter of `name`, on a chosen colour, in the same hue mix as avatars so tiles and initials sit together in a row. `icon` is one of `channelIconNames` (24 plain objects that read at 16px: hash, megaphone, chats, rocket, code, bug, wrench, flask, shield, lightning, globe, compass, flag, star, heart, leaf, coffee, gift, trophy, book, briefcase, calendar, camera, truck; `channelIcons` maps a name to its component), `color` one of `channelColorNames` (the eight person hues). `defaultChannelLook(id)` is what a channel gets before anyone changes it: a colour hashed from its id and no icon, so a list of untouched channels still tells them apart by letter. `size` as Avatar; radius 16 / 12 / 12 / 8 / 7 / 6 / 5 by size. `label` for the accessible name when the channel name is not visible beside it. The choice is client-only (SPEC §3) and the view that changes it is `ChannelIconPicker` in `@juno/views`.

`Swatch`: a round 24px colour choice, a bold check and a ring when `selected` (`aria-pressed`; in a radio group, `radioItem` makes it a radio with `aria-checked`). Required `label`. `hue` draws a person or channel colour in the avatar mix (the channel picker); `accent` draws an accent's solid fill from the `accentSwatches` tokens (the appearance settings). The accent picker uses it too. `tint` draws an icon tint (`iconTints`, `neutral` included) with the check in the page colour (the view sheet's Colour). The label is the tooltip.


## 5. Chip

Small inline label. Replaces tags, count badges, status chips, decision chips, summary chips, confidence badge, scope chip.

| Prop | Values | Notes |
| --- | --- | --- |
| `variant` | `outline` (Main), `filled` (Reopened, Open, Digest, #channel), `strong` (`--secondary-active`; the topic switcher's unread count), `count` (`--hl-count` / `--hl-count-fg`; the sidebar's counters), `soft` (`--hl-soft` + inset ring; @), `accent` (`--hl`; Now, @ in Browse), `mention` (`--hl-mention` / `--hl-mention-fg`; @you in a message), `success` (resolved tint), `quiet` (transparent, muted), `surface` (`--surface-hover`), `person` (the inline @mention: `hue` mixed 16% into the surface and 40% into the text, weight 600; `hue` as Avatar) | Every chip is a pill (`--radius-tag`) |
| `size` | 18 (tag), 20 (badge), 22 (status), 24 (summary, reaction), 26 (scope), 28 (notification setting tag), `inline` (follows the surrounding line; padding 0 5) | Text 11 / 11 / 12 / 12 / 12.5 / 13 / inherited |
| `icon`, `iconSize` | 12–13, bold | sparkle in the confidence badge |
| `numeric` | boolean | tabular figures |
| `onRemove`, `removeLabel` | | Adds a 20×20 close IconButton (12px bold X) |
| `interactive`, `pressed` | | Renders a toggle `button` (reaction chips: 1px `--border-default`, pressed = `--hl-soft` + `--hl-ring` border and the count in `--foreground-default`); toggling changes colour at once without motion |
| `title` | tooltip | |

## 6. ContextPill

The tinted "where" pill, fully round (`--radius-pill`). It draws what it is given and knows nothing about conversation kinds: `tint` `public` | `private` | `dm` (the three tints in the tokens; group DMs use `dm`), `icon` (`Hash`, `Lock`, `User`, `Users`, bold at 12 / 14 / 14), `name` without "#", `kindLabel` ("Public channel", also the tooltip) shown after a dot at 400 when `showKind` is set (the To field and cards; the header shows the name only, with the kind in the tooltip and the accessible name); `size` 22 (card), 24 (header: 12.5px, icon 13), 26 (default), 28 (To field). With `onClick` the pill is a button (the header's: narrow the sidebar to the channel) and `label` is its accessible name, which carries the kind ("eng, public channel. Show in sidebar."). The kind → tint, icon and label mapping is a `@juno/domain` rule applied by the view. In a tight row the name takes the ellipsis; the pill never gets narrower than its icon and kind (a grid whose name track gives way to zero), so the kind never spills over what comes next.

`presence` (`active` | `away`, a DM's person): a `PresenceDot` (`inline`) takes the icon's place inside a box of the icon's size, so the pill keeps its width, and the tooltip adds "Active" or "Away". The owner adds it to `label`.

`iconWhenNarrow` (the topic header): under the header's 480px container width the pill is its icon alone, a circle as tall as the pill, so the title gets the room. The name stays in the accessible name, and the tooltip names the place and its kind in both forms ("eng · Public channel").

## 7. Kbd

Keyboard hint in the mono face. `look` `plain` (muted text: "⌘J", "↵") or `key` (keycap: "esc"). `inherit` uses the surrounding colour at 0.75 (inside the toast Undo).

## 8. Text

Typography. `variant` maps to the five variables of a type role in tokens: `sectionLabel`, `tableHeader`, `divider`, `tag`, `tagSmall`, `meta`, `pill`, `buttonSmall`, `ui`, `preview`, `bodySmall`, `body`, `rowTitle`, `messageName`, `heading`, `topicTitle`, `pageTitle`, `pageTitleCompact`, `display`, `emptyTitle`, `kbd`, `code`. Props: `tone` (`inherit` | `default` | `subtle` | `muted` | `accent` | `danger`), `weight` override, `truncate`, `clamp` (1–3), `numeric`, `selectable`, `as`, `sx` (layout styles only; the type rejects colour and font properties). ARIA `role` passes through. Block variants default to a block tag (`p`, `h1`, `h2`, `pre`).

## 9. Surface, Divider, LabelledRule

`Surface` `kind`: `peek` (`--peek-surface`, `--peek-shadow`, radius 13, no padding; the read-only topic preview), `card` (surface + `--card-ring`, radius 20, padding 14), `popover` (`--pop-shadow`, radius 13, padding 6), `toolbar` (`--pop-shadow`, radius 16), `group` (card with no padding, clips children), `inset` (`--background` + 1px `--border-default`, radius 8), `field` (the composer frame: surface + 1px `--input-border` that turns `--focus-ring` on `:focus-within`, with no extra ring, radius 20, a pill at its single-line height), `toast` (ink on paper, `--shadow-lg`, radius 14), `island` (the page header's islands: `--surface-default`, `--card-ring`, `--radius-pill`, a flex row with a 2px gap, the inset of 3 that is left around a 28px control, height `--header-island-height`; inventory §5). `--card-ring` and `--pop-shadow` are wide soft shadows with no ring. `padding` `none` | `xs` 4 | `sm` 6 | `md` 12 | `lg` 14 and `radius` override the defaults. Floating kinds carry a transparent 1px border so a ring never changes layout.

Sheets are not a primitive: a view puts a `Surface kind="popover"` with `role="dialog"`, `aria-modal` and its own title in `SheetLayer` (`@juno/views`), which dims the window, closes on Esc, keeps Tab inside and gives focus back to the opener. It centres the sheet; `anchor="top"` instead holds the sheet's top `--sheet-top-offset` (120) from the window's top, for a sheet whose height changes while it is open (the status sheet), so only its bottom edge moves. The Backup sheets, Connections' Configure and Home's reviews (`ReviewSheet`, one for every card) do; a review sheet puts its buttons at the bottom right, the default action last, as a Mac sheet does.

`Divider`: 1px, `tone` `default` | `subtle`, `vertical`, `inset`. `LabelledRule`: the "3 new" divider, `label` + rule in `--hl` / `--hl-rule` (or `muted`); fills its row.

`HeaderBand`: the static band behind a page header's islands (`--header-band` tall, solid to `--header-band-solid`, then a fade), `aria-hidden`, no pointer events. Used by the topic header, the Juno tab and the Juno panel; `surface="panel"` draws it in `--panel-fill` for the panel.

## 10. Popover and OptionList

`ContextMenu`: a context menu drawn like the macOS one, for the message menu (inventory 6.5): `anchor` (a point, or a button's left edge and bottom with its size, `trigger`), `items` (`{ id, label, icon?, disabled?, shortcut?, trailing? }` or `{ separator: true }`; two separators in a row, or one at an end, never show; `shortcut` is a key equivalent, a letter or ⌫, shown at the row's end in the icons' colour and chosen by its key while the menu is open; `trailing` (`{ id, label, icon }`) is a second action drawn as an 18px icon button at the row's end, its own menu item named by `label` (also its tooltip): → from the row reaches it, ← goes back, choosing it calls `onSelect` with its id, the row highlights while either has focus and the button takes `--menu-trailing-hover` when it does; not shown on a disabled row), `header` (the emoji grid), `label`, `onSelect(id, { metaKey })`, `onClose`, `panelWidth` and `morph`, and `inline` for the gallery (drawn inside its positioned parent, which stands in for the window). The `menu` tokens' material, rows and separators; the highlight is focus (the pointer focuses the row or cell it moves over, the arrows move it, so the two never disagree), with the accent fill. Placed in a layout effect before its first paint, fixed in a portal on `body` (`--z-context`, `no-drag`): its top a pixel under the anchor, never above it, moved up only as far as the window's bottom needs, `--menu-edge` (6) inside the window; to the right of the anchor when `panelWidth` (or its own width) fits there, else its right edge at the anchor; from a button, lined up with its left edge or, opening to the left, its right edge, and above the button when only that fits. A click or Enter chooses (⌘ passed on); typed letters jump to a row; Tab stays; Esc, a press or a wheel turn outside, the window losing focus or resizing close it (a list scrolling by itself does not); a press on a button marked `data-menu-toggle` is left to that button, which closes its own menu or opens another. Focus goes back to a field or a keyboard-focused element it took focus from. `morph` turns the menu into a larger panel in motion (internal `menuMorph.ts`, `MorphLayers.tsx`): the panel is laid out at its final size, placed so one corner of the menu stays put (`placeMorph`: grown the way the menu opened, downward from its top when it fits, else upward from its bottom), and played back from the menu's box over `--duration-morph` on `--ease-morph`: Web Animations on transform and opacity, the material and a clipping layer scaled about the pinned corner, both contents scaled back about it so text never stretches, a cross-fade, and the material's corners and shadow scaled back so they keep their size. Reduced motion shows the panel at once. The panel's own keys are its own (`data-menu-own-keys`), Esc aside.

`Popover`: renders `anchor` in place and, when `open`, a `popover` Surface next to it. `placement` (`bottom-start` | `bottom-center` | `bottom-end` | `top-start` | `top-end` | `right-start`; `bottom-center` centres the panel under the anchor, as the avatar menu does; `right-start` is a submenu's, below), `width` (`menu` 236, `account` 248, `browse` 300, `mention` 280, `anchor`), `maxHeight` (`popover` 400, `picker` 300), `layer` (`mention` | `picker` | `menu` | `context`), `role`, `label`. A panel is capped at the room on its side of the anchor (above for an upward one, below for a downward one), so it stays inside a short window and the rest scrolls. `alignTo` (a selector inside the anchor) puts a start placement's left edge on that element's left edge, for an anchor wider than the control that opens it: the topic switcher hangs below the whole left island but starts at the title button. A popover always lines up with the control that opened it, never with a wrapper around it, and moves in only at the pane's edge. Closes on Esc, outside pointer-down and focus leaving (`closeOnBlur`). Esc with focus in the panel, or still on the anchor after a mouse open, puts focus back on the anchor with its ring. Scroll is contained. The clamp works from the panel's own place, so a second pass (development attaches the ref twice) writes the same shift. The panes a popover hangs in clip with `clip`, not `hidden`, so a field in the panel taking focus before the clamp runs cannot scroll the pane sideways to show it: the shell and the workspace on the x axis only, since a y clip at the window's edge stops Chromium's lazy images loading just below the fold, and the Juno panel's body and the peek on both (inventory §1). Closes on Esc, outside pointer-down and focus leaving (`closeOnBlur`). Scroll is contained. Opens and closes at once, as a native menu does: the panel mounts and unmounts in its final place, with no fade or scale.

`Submenu` and `useSubmenu`: a menu row whose choices open in their own panel beside the menu, as on macOS (the avatar menu's Pause notifications). The panel is a `Popover` with `right-start`: its root takes no position, so the panel hangs off the menu's own panel, outside the menu's scrolling surface, 4px to its right, its first row level with the row; it flips to the left when the right has no room and moves up at the pane's bottom. `useSubmenu({ triggerId, ids, onSelect })` holds whether it is open and its own active row. It opens after the pointer rests 200ms on the row, on a click, and on → or Enter, which also highlight the first choice and move focus into it. Escape and ← close only the submenu and give focus back to the menu. While it is open the pointer may cross other rows inside the triangle from where it left the row to the panel's near edge without closing it, unless it rests 300ms on one; moving the menu's highlight with the keys closes it. The owner spreads `trackPointer` on the menu's list, calls `keyDown` first in its key handler, and `hoverTrigger` and `hoverOther(activate)` from the rows' `onActivate`.

Menus are not a separate primitive: an in-app menu (the account menu) is an `OptionList` with `role="menu"` inside a `Popover`; its rows become `menuitem`s. In a `listbox`, rows are `option`s and `aria-selected` is the real selection only (the keyboard highlight is `aria-activedescendant`). Real context menus are native.

`OptionList` (`role` `listbox` | `menu`, `activeId` → `aria-activedescendant`, `focusable` to handle keys on the list itself) + `OptionRow` (`id`, `leading`, `label`, `sub` with `subPlacement` `end` | `inline` | `below`, `trailing`, `active`, `selected`, `disabled`, `size` 30 | 32 | 34 | 55, `leadingOnFirstLine` for a 32px row whose label has a second line under it (the icon stays centred on the first line, in the 32px a one-line row gives it), `onSelect`, `onActivate` on pointer move, `onContextMenu`). `active` is the one filled row (`--surface-hover`), the keyboard's or the pointer's; `selected` (the current value) has no fill but takes `--hl-text` and a 14px bold check at the end, as a Mac pop-up menu marks its item, so two rows are never filled at once (decided 10-17). Rows select on mouse down and keep focus in the owning input. Home's topic list (`TopicList`) puts a 20px `TopicArt` in `leading`, so a thread looks as it does in the sidebar. `OptionGroupLabel` (PEOPLE, RECENT), `OptionSeparator`, `OptionHeader` (avatar + two lines). `useOptionListKeys({ ids, activeId, onActiveChange, onSelect, onClose, selectKeys })` returns the key handler for ArrowUp/Down (wrapping), Home/End, Enter (and Tab for suggestions), Esc.

## 10a. ScrollArea

`ScrollArea`: a vertical scroll container (`overflow-y: auto`, contained overscroll) with `scrollbar` (`always` | `hover`), `as`, a `ref` to the scroll element (the message list's container reads and sets the position through it) and a layout-only `sx`. The scrollbar is the 10px classic bar from `global.css` in both modes, so the gutter never changes size. `hover` sets a `--scrollbar-thumb` variable to transparent and to `--border-strong` under `:hover` (hover-capable pointers only); the `::-webkit-scrollbar-thumb` inherits it explicitly and reads it. `global.css` registers the variable as not inherited, so entering the area restyles only the area, not the rows inside. A scroller nested in a hover area (a code block in the message list) hides its thumb the same way, by a `global.css` rule on the thumbs inside the area. The track is transparent always. Keyboard and trackpad scrolling are the browser's. `underHeader` is for a list that runs under a page header's islands: it adds the `--header-inset` top padding, `scroll-padding-top: --header-band` and a `--header-band` top margin on the scrollbar track, all in CSS. The sidebar topic list and the message list are `ScrollArea scrollbar="hover"`; `Page`, `Popover` and `CodeBlock` keep the always-on bar for now.

## 11. Tabs

`TabStrip` (44px drag region, full width, bottom border; the scroller is only as wide as its tabs, so the `trailing` slot, a tab-high square for the new-tab IconButton, follows the last tab and stays at the strip's end once the tabs scroll) + `Tab` (`icon` at 0.75, or `leading` to fill the fixed 15px icon slot with a topic's art, `label`, `active`, `onSelect`, `onClose` with `closeLabel`, `onContextMenu`; 35px, radius 8 8 0 0, flex 0 1 230, min 72; the active tab's bottom border is the page colour so it merges).

## 12. Fields

`TextField`: 1px `--input-border`, surface background, focus shown on the container (the border turns `--focus-ring`; no extra ring, since a field always holding focus, like the Juno panel's composer, read heavy with two). `size` 30, 32, 34, 36, 44 (radius 7 / 7 / 8 / 8 / 10). `leadingIcon` (search), `leading` slot (the "To" label and a ContextPill), `trailing`, `width` (`full` | `search` 260 | `keyword` 160), `text`, `label` (required without a visible label), `invalid` (danger border, `aria-invalid`).

`Textarea`: `variant` `inline` (composer: no border, 22px line height, grows with `field-sizing: content` to `maxHeight` `composer` (`--composer-max-height`) or `assistant` 160 then scrolls; the frame keeps the textarea inside its 1px border, so scrolled text is cut below the border, and within the box the text fades out over the top 16px (`--space-4`), a static mask set while the field is scrolled at all (state that changes only when `scrollTop` leaves or reaches 0), so a field at its top fades nothing and no animation runs on it; no layout is read on a keystroke), `card` (send card, `--background`, 2 rows), `field` (drawn like a 32px TextField: 1px `--input-border` that turns `--focus-ring` on focus, radius 7, 6/10 insets, ui text; grows with `field-sizing: content` from one line to 176 (8 lines), then scrolls; a note or pin under edit on What Juno remembers). `marks` (inline only) draws runs of the text as chips: the field's own text turns transparent and a layer under it draws the same text in the same box, with each marked run in the `person` chip's hue or the `filled` chip's look. Chips keep the text's weight and give their 2px inset back with a negative margin, so no glyph moves from where the caret and selection expect it; the layer follows the field's scroll. `anchorAt` makes that character the `--textarea-anchor` for CSS anchor positioning (the mention list).

`Select`: native `<select>` styled like a 30 or 32px field with a muted chevron; `options[]`. `SelectButton` is the same field as a button, for a list Juno draws itself in a `Popover` where the OS menu cannot filter (Settings › Ignored's add row, All topics' place): `size` 28 | 30 | 32, `leading` (the chosen item's icon, muted), `placeholder` (the prompt in the muted tone), `expanded`, `fill` (as wide as its box, for a grid cell); `aria-haspopup="dialog"`. It shrinks with its row and cuts a long value with an ellipsis.

`Checkbox`: native 15px with `accent-color: --foreground-default`; `label`, `description`, `size` `md` (13.5) | `lg` (14).

`Slider`: `<input type="range">` with a 4px track (`--secondary-active`, filled part in `--foreground-default`), 14px ink thumb with a 2px `--background` ring; `min`, `max`, `step`, `value`, `label`, `valueText`, `disabled`.

`Segmented`: track padding 2 on `--surface-hover`, radius 7; segments 24px radius 5, 12/500, selected = `--surface-raised` + `--shadow-sm` (raised in both themes). Radio group with arrow keys. `options[]`, `value`, `onChange`, `label`, `disabled`.

The composer is a feature component: `Surface field` + slots + `IconButton` + `Textarea inline` + `IconButton`. The buttons sit at the end of the row with a bottom margin of (40 − 28) / 2 so they centre on the single line and on the last line once the text has grown.

## 13. ListRow

Generic row for settings groups, logs and tables: `minHeight` 32 | 44 | 48 | 52, `padding` `settings` (8 14, the same inset at both ends) | `table` | `log` | `navigation` (0 12, sidebar navigation’s 8px gap, 20px leading slot, 4px body gap and radius 12; a `selected` navigation row takes NavItem's `--hl-nav` fill, so it reads apart from a hovered row), bottom `divider` (default on), `leading`, `trailing`, children. With `onSelect` it is a focusable `role="button"` with a hover background and radius 16 (`selected` for the current row; muted text inside a selected row renders subtle). Rows set `contain: content`. With `revealTrailing`, the trailing controls show only while the pointer is on the row or focus is inside it (and always on a pointer that cannot hover), by opacity alone, so nothing moves and they stay in the accessibility tree (Edit and Delete on What Juno remembers). With `wrap`, a row whose text would get narrower than `--list-row-wrap-min` (200) puts its trailing controls on a line of their own under the text, at the start, where they wrap too (the Notifications hours rows). Sidebar topic rows and All topics rows are feature components built on this.

## 14. Toast

`Toast`: `toast` Surface (radius 14), optional filled `icon` in `--toast-success` (the check in the resolve toast), 13px text (one line, ellipsis), optional `action` (`label`, `kbd`, `onAction`) drawn as a 26px translucent pill. Rises in 8px with opacity over `--duration-appear`. `ToastRegion` pins its child bottom-left (16/16, z 45). Lifetimes, the exit fade (`--duration-exit`) and replacement (key the toast so a replacement cross-fades rather than sliding again) are the owner's job.

## 15. EmptyState

Centered `illustration` (optional; an `IllustrationName`, 96 wide in `list`, 120 in `workspace`, 14px above the title), `title`, `body` (why it is empty) and one `action`. `variant` `list` (14/500 title) or `workspace` (serif 30 subtle). `padding` `list` (48 16) or `page` (48). The parts enter staggered 80ms apart (opacity and a 6px rise) once, when the state mounts; the owner passes `enter={false}` when the state was visible less than a second ago so a filter change just shows it. Copy for each empty state is in `friendly-layer.md` §7.

## 15a. Illustration and Logo

`Illustration` `name`: `caught-up` (the seated j with a tablet on its lap and a check; Unread filter with nothing unread), `nothing-here` (a tray with two faded rows; a filter hides everything, All topics and Browse with no match), `nothing-open` (a blank tablet with two reply dots; no tabs), `no-results` (a magnifying glass over two rows; ⌘K), `juno` (the seated j alone on a warm disc; the Juno chat empty state). `size` `list` 96 | `workspace` 120 | `figure` 40. One colour (`--foreground-subtle` through `currentColor`), stroke 4 on a 104 by 72 grid, round caps, filled dots, one `--warm-soft` layer. Decorative; the title says what it means.

`Logo`: the laptop-two mark in `currentColor`. `size` 16 | 18 | 20 | 24 | 28 | 32 | 40 | 44; `label` ("Juno") when it is not decorative. The sign-in page shows it at 40; the assistant's avatar is 28.

`Pebble`: a Tide pebble (the placeholder `TopicArt` shows for a topic with no art) drawn large as decoration. `seed` picks the shape, hues and bands as a topic id does; `size` in px; `accentBand` paints the lowest band in `--hl-band`. Drawn as React SVG from `pebbleShape` in `@juno/topic-art`, so each band is its own element. Decorative (`aria-hidden`). Used only by the sign-in page's art.

## 15b. ProgressRing

A determinate ring, as macOS draws one for a download: `value` out of `max`, a `--border-strongest` track and an `--hl` arc from twelve o'clock with round ends. Without `max` it draws the track only (the total is not known yet). `size` 16 | 20 (default 20), stroke 2 and 2.5. It is the `progressbar` itself: `label` is required ("Sync progress") and `valueText` is what a screen reader says ("11 of 148 conversations"). The arc does not animate; each value repaints it. Used by the sidebar's sync status card.

## 16. Page, PageHeader, Section

`Page`: scrolling page with a centred column, `width` `narrow` 680 | `default` 720 | `settings` 760 (every settings page), padding 40 32 72. The scroller keeps a stable scrollbar gutter, so the column does not move when the page starts or stops overflowing. Inside `PageUnderHeader` (a context a frame sets when a header's islands lie over the page, the Juno pages), the scroller takes the `--header-inset` top padding, `scroll-padding-top: --header-band` and the scrollbar track below the band, as `ScrollArea underHeader` does, and the column's top padding is 16. `PageHeader`: serif `title` (`size` `compact` for the 32px All topics title), `subtitle`, `trailing` slot. `Section`: 15/600 `heading` + 13 muted `sub` + children (usually a `Surface group`), and an optional `action` at the end of the heading's line (a ghost `xs` button, Add on What Juno remembers) in a slot of no height, so the line is as tall with it as without.

## 17. CodeBlock

Mono 12.5 lh 1.6 inside a `Surface inset`, pre-wrap, max-height 150 with contained scroll, selectable. Code in Juno cards.

## 18. Card

`Surface card` with a meta header (`kindIcon` + `kind`, `·`, `sourceIcon` + `source`, `onDismiss` 22px IconButton), `title` (15/600), `body` (13.5 subtle), `children` (prompt block, reply options) and `actions` (wrapping Button row). Used by assistant cards (For you, its first user, is removed); the settled hint uses `Surface card` directly.

---

## 14a. Tooltip

`TooltipLayer`, mounted once at the app's root, is the only tooltip. An element asks for one with `tooltip(label, keys?)`, which returns `data-tooltip` attributes to spread on it; `IconButton`, `AvatarButton` and `Swatch` do it from their `label`. The browser's `title` tooltip is kept only for text that is cut off and for content (times, file names).

- One delegated listener on the document, so nothing is mounted per control. It shows after 700ms of hover or of keyboard focus (`:focus-visible`), like macOS; once one has shown, a neighbour's shows at once for 600ms.
- Hides on mouse down (and stays hidden until the pointer leaves that control), on scroll, on Esc, on a drag and when the window loses focus. None shows while a mouse button is held, so a tab dragged along the strip passes its neighbours without one; tabs carry their title as their tooltip. A control whose menu is open (`aria-expanded="true"`) shows none.
- Under the control, 6px away, or over it when there is no room below; never on it. Centred on the control, except a tip with a detail line (below), which starts at the control's left edge. Moved in to stay 8px inside the window, or inside a `data-tooltip-bounds` ancestor (the gallery frame). Fixed in a portal on `body`, `--z-tooltip`, so it moves nothing.
- `--surface-raised`, `--pop-shadow`, radius 6, padding 4 / 8, meta type in the default colour, at most `--tooltip-max-width` (280) wide. Keys sit 8px after the label as 16px keycaps, one per modifier (⌃ ⌘ S on the Mac, Ctrl Shift S on Windows), `--secondary-default` with subtle mono text. Fades in over `--duration-fast` the first time; warm ones appear at once.
- `role="tooltip"`; the control's `aria-describedby` points at it while it shows.
- A detail line under the label, from the layer's `detail(target)` (the app passes one that reads `data-tooltip-person` and shows that person's Slack status and "Notifications paused", inventory 2.1b). Over a detail line the label is the title, at `--weight-semibold`, so it reads as one at the tip's size. Such a tip starts at the control's left edge and is at most `--tooltip-detail-width` (240) wide, so a line that arrives after it shows grows it right and down, never sideways; it is placed again when its size changes. The layer's `prepare(target)` hears each control as the pointer or focus reaches it, before the delay ends, so the detail can be ready when the tip opens; the cleanup it returns runs when the pointer moves on.

Shortcuts come from the app menu's accelerators in `@juno/contract` (`menuShortcuts`, with Windows' own keys through `menuAccelerator`) through `menuKeys('history.back')` in `@juno/views`, so a key changes in one place and Windows reads "Ctrl+[" where the Mac reads "⌘[".

## What is not a primitive

Feature components that compose the above and hold app logic: `Sidebar`, `TopicRow`, `TopicHeader`, `MessageList` / `Message` / `Bubble`, `MessageText` (token segmenting into Chips), `HoverToolbar`, `Composer` (with `SendCheckBar`, `AudienceWarning`, `MentionSuggestions`), `CommandPalette`, `AllTopicsTable`, `ForYouCard`, `JunoThread` (+ `SendCard`, `TopicsCard`, `ResolveCard`), `NotificationRules`, `IgnoreList`, `NewMessageForm`, `ContextMenu` (native bridge).

The huddle views (`@juno/huddle-views`, inventory 22) add no primitive. They are built from `IconButton` (`variant="island"`, radius `lg` in the bar, `full` in the tab), `Surface kind="island"`, `HeaderBand`, `ContextPill`, `Avatar`, `Popover` with `OptionList` (the device menu), `EmptyState`, `Button` and `Text`. Three small parts are kept inside the package, each with fewer than three uses, so none is promoted yet:

- `PeopleStack`: `AvatarStack`'s overlap and "+N" with the speaking ring on a face (bar, header control). `AvatarStack` has no per-person state; if a third place needs the ring, add a `speaking` field to `AvatarStackPerson` instead.
- `TextControl`: a 28px text button with the island fills (Leave, Thread), the same look as `IslandButton` in `@juno/views`, which this package cannot import. If a third package needs it, move `IslandButton` into `@juno/ui`.
- The source picker's tile: a radio with a picture and a name, used once.

## Count

24 primitives (Surface gains the `island` kind and `HeaderBand`): Icon, Button, NavItem, IconButton, Avatar (+AvatarStack, AvatarButton, PresenceDot), ChannelIcon (+Swatch), Chip, ContextPill, Kbd, Text, Surface (+Divider, LabelledRule), Popover/OptionList, ScrollArea, Tabs, Fields (TextField, Textarea, Select, Checkbox, Slider, Segmented), ListRow, Toast, EmptyState, Illustration, Logo (+Pebble), ProgressRing, Page/PageHeader/Section, CodeBlock, Card.

Differences from the first proposal: Button's accent variant is called `primary`; Tile and Avatar are one component; Menu/MenuItem were folded into OptionList (same row anatomy, one keyboard model); PageHeader got a `Page` container for the width and padding instead of setting them itself; `Icon` takes a component rather than a name.

`Text topicTitle` follows `--topic-title-lines` for list titles, with ellipsis and no reserved second line. Combine with `tooltipWhenTruncated` to show the full title only while its width or height is clipped.
