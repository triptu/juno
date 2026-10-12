# The friendly layer

Direction for making Juno feel playful and friendly without giving up what makes it calm. The spec's layout, whitespace, quiet sidebar and native feel stay exactly as they are. Personality goes into the details: the icon set, the shape of small things, a little more colour where a person is involved, quick springy feedback on infrequent actions, a few spot illustrations, and warmer copy.

Where this document and `tokens.md`, `primitives.md` or `inventory.md` disagree, this document wins; section 9 lists the edits to apply to `tokens.md` so they stop disagreeing. `docs/design/handoff/SPEC.md` still decides behaviour.

The before/after mock is `docs/design/friendly-layer/mock.html` (renders: `mock-light.png`, `mock-dark.png`). Serve the repo root over HTTP to open it; the fonts load from `packages/tokens/node_modules`.

## 1. What friendly means here

- Rounded, not boxy. Small labels are pills; containers get one step more radius.
- Solid when it matters. Active and selected icons are filled, everything else is outline.
- People have colour. The per-person hue shows wherever a person is named, not only on avatars.
- Feedback has a little bounce, only for things you do a few times a day.
- Empty states have a small drawing and sound like a person.
- Copy is warm and short. It never jokes, never exclaims, never uses emoji.

What it is not: no mascots in chrome, no gradients, no confetti, no bright badges, no rounded-everything, no "fun" fonts. The seated j is the one character, and it appears only in illustrations and the Juno surfaces.

## 2. Icons: Phosphor

Replace `lucide-react` with `@phosphor-icons/react` (icon assets `@phosphor-icons/core` 2.1.1; the React package follows the same names). Phosphor icons are filled paths on a 256 grid, not strokes, so weight is chosen by variant (`thin`, `light`, `regular`, `bold`, `fill`, `duotone`), never by `stroke-width`.

### 2.1 Weights

| Weight | Rendered line at 16px | Use |
| --- | --- | --- |
| `regular` | 1px | All chrome at 15px and up: title bar, nav, header actions, hover toolbar, menus, palette, tabs |
| `bold` | 1.5px | Everything at 14px and below: row meta, tags, pills, chips, close buttons, chevrons, the send arrow. Regular drops under 1px there and goes faint next to 11–12px text |
| `fill` | solid | Active or selected states only: the active nav item, the subscribed bell, the pinned pin, a pressed toggle, the check in a resolve toast |
| `duotone` | 1px line + 20% fill | Deliberate friendly spots only: the Juno nav item and AI sparkles, For you card kinds, spot illustrations. Never in a toolbar or a row |
| `light`, `thin` | | Not used. Too faint on paper at our sizes |

Rule: outline is the default, fill marks state. The swap from outline to fill is the one icon change that may animate (section 5).

### 2.2 Sizes

Phosphor glyphs fill about 73% of their box; Lucide fills about 83%. To keep the same visual size, Phosphor goes one step up from the Lucide size it replaces.

| Lucide size | Phosphor size and weight | Where |
| --- | --- | --- |
| 11 | 12 bold | Badges, chip close |
| 12 | 13 bold | Row meta (channel, count), tags, tab close, row Resolve check |
| 13 | 14 bold | Context pill, cards, thread link, catch-up sparkle (duotone) |
| 14 | 15 regular (tab icon), 16 regular (buttons), 16 duotone (AI sparkle beside a title) | |
| 15 | 16 regular | Nav items, menu items, option rows |
| 16 | 18 regular | Title bar buttons, header icon buttons, hover toolbar, palette rows, send arrow (bold) |
| 18 | 20 regular | Attach, palette search |

`IconSize` becomes `12 | 13 | 14 | 15 | 16 | 18 | 20`. Icons centre on the flex line box next to Inter with no manual nudge; Phosphor's 32-unit margin already sits the glyph on the cap height. Check at 13 next to 11px tags in the gallery and nudge in the SVG, not with a margin, if anything looks high.

### 2.3 Mapping from the Lucide icons in use

Every Lucide import in `packages/ui`, `packages/views` and `apps` today, plus the icons the inventory names for later features.

| Lucide (in code) | Phosphor | Notes |
| --- | --- | --- |
| `Hash` | `Hash` | bold at ≤14 |
| `Lock` | `Lock` | |
| `User` | `User` | |
| `Users` | `Users` | |
| `Search` | `MagnifyingGlass` | |
| `SquarePen` | `NotePencil` | New message |
| `Moon` / `Sun` | `Moon` / `Sun` | |
| `LayoutList` | `ListBullets` | fill when All topics is active |
| `Lightbulb` | `Lightbulb` | fill when For you is active; duotone on the Reply ideas card |
| `Sparkles` | `Sparkle` | duotone in nav, beside AI titles and on AI cards; fill when the Juno tab is active |
| `Bell` | `Bell` | fill when subscribed |
| `BellOff` (planned) | `BellSlash` | |
| `Pin` | `PushPin` | fill when pinned |
| `CircleCheck` | `CheckCircle` | regular on the Resolve button; fill in the resolve toast and on the Tidy up card (duotone) |
| `Check` | `Check` | bold, row Resolve |
| `X` | `X` | bold |
| `Plus` | `Plus` | |
| `ArrowUp` | `ArrowUp` | bold, send |
| `Ellipsis` | `DotsThree` | bold |
| `MessageSquare` | `ChatCircle` | bold, row message count |
| `MessagesSquare` | `ChatsCircle` | bold; Main rows, thread link, wrong-place check |
| `MessageSquareReply` (planned) | `ArrowBendUpLeft` | Reply in thread, hover toolbar |
| `Reply` | `ChatCircleDots` | duotone, Waiting on you card kind |
| `Quote` | `Quotes` | |
| `SmilePlus` | `Smiley` | More reactions (no SmileyPlus exists) |
| `Send` | `PaperPlaneTilt` | palette send row |
| `Terminal` | `Terminal` | duotone, Coding agent card kind |
| `CalendarCheck` | `CalendarCheck` | duotone, Follow-up card kind |
| `Settings` | `Gear` | |
| `LogOut` | `SignOut` | |
| `ArrowLeftRight` | `ArrowsLeftRight` | Switch workspace |
| `CircleDot` | `DotOutline` | Set status |
| `AtSign` | `At` | bold |
| `Inbox` | `Tray` | Browse "All topics" row; duotone in the empty Browse state |
| `ListFilter` | `FunnelSimple` | |
| `EyeOff` | `EyeSlash` | stealth tab and pill |
| `RotateCcw` (planned) | `ArrowCounterClockwise` | Reopen |
| `Ban` (planned) | `Prohibit` | Ignore channel |
| `ChevronRight` (planned) | `CaretRight` | bold, thread link |
| `SpellCheck` (planned) | `TextAa` | clarity check |

### 2.4 The Icon wrapper

`Icon` keeps its shape (component in, never a name) and gains a weight.

```ts
type IconWeight = 'regular' | 'bold' | 'fill' | 'duotone'
type IconSize = 12 | 13 | 14 | 15 | 16 | 18 | 20

interface IconProps {
  icon: PhosphorIcon           // from '@phosphor-icons/react'
  size?: IconSize              // default 16
  weight?: IconWeight          // default: bold at <= 14, regular at >= 15
  active?: boolean             // shorthand for weight="fill"; the active-state pair
  dim?: boolean                // tab icon opacity, unchanged
  label?: string               // unchanged
}
```

- The default weight comes from the size, so call sites only name a weight for `fill` and `duotone`. `active` exists so a toggle can write `active={subscribed}` and get the outline/fill pair without naming weights.
- Render with `<Phosphor weight={weight} size={size} color="currentColor" />`; drop the `stroke`, `fill: none` and `strokeWidth` styles and the `--icon-stroke` / `--icon-stroke-small` tokens. Phosphor already sets `fill="currentColor"`.
- `Button`, `IconButton`, `NavItem`, `Chip`, `ContextPill`, `Tab`, `Card` and `OptionRow` take `PhosphorIcon` where they took `LucideIcon`. `NavItem` and `IconButton` pass `active` through from `active` / `pressed`; `Tab` uses the regular weight even when active (tab switches do not animate and the filled set is too heavy in a strip).
- Keep the `icon` prop as a component, not a string, so only the used icons are bundled. Phosphor ships each icon with all six weights in one module (about 1.5 KB each); the 45 icons above add roughly 70 KB to the bundle, inside the 1.0 MB budget. Measure once with `pnpm build`.
- Do not set `mirrored`; none of our icons depend on reading direction.

## 3. Shape

Keep the nesting rule (outer = inner + padding) and compute new containers from it. The changes:

| Element | Now | Friendly | Token |
| --- | --- | --- | --- |
| Tags, count badges, @ tag, status chips, decision chips, scope chip, digest chips, stealth pill, confidence badge | 6 | full | new `--radius-tag: 999px` |
| Reaction chip | 6 | full | `--radius-tag` |
| Context pill (header, To field, send card) | 6 | full | `--radius-pill: 999px` (new) |
| Row Resolve button (22px) and the toast Undo button (26px) | 6 | full | `--radius-tag` |
| Inline @person and #channel chips | 4 | full, padding 0 5 (was 0 3) | `--radius-tag` |
| Channel tile (44 / 36), chat and card rows, cards, To field, composer | 10 / 10 / 10 / 10 / 12 | 12 / 12 / 12 / 12 / 14 | `--radius-xl` 10 → 12, `--radius-2xl` 12 → 14 |
| Toast | 10 | 14 | `--radius-toast: 14px` (new) |
| Nav and filter buttons | 7 | 8 | use `--radius-lg`; `--radius-md-plus` stays for selects and the segmented track |
| Everything else (buttons, menus, palette, inputs, tabs, bubbles) | | unchanged | |

Rule of thumb: a label is a pill; a control or a container is a rounded rectangle. Pills never nest inside pills.

Nesting pairs after the change: menus 13 = item 6 + padding 6 + 1 border (keep); palette 14 = item 8 + 6; segmented 7 = 5 + 2; hover toolbar 8 = 6 + 2; card row 12 = tile 12 nests with the 12px padding only by eye (the tile is not inset evenly, so the rule does not apply, same as today).

## 4. Colour

The palette does not change. Colour is used in a few more places, always derived from tokens that already exist.

### 4.1 Person hues

A person's hue (tokens 1.6) now shows on:

- **Avatars**: unchanged (24% background, 62% foreground).
- **@mention chips** in message text, the composer, Juno replies and send cards: new mix so the text passes 4.5:1 for every hue in both themes.
  - `--person-chip-bg: color-mix(in oklch, <hue> 16%, var(--surface-default))`
  - `--person-chip-fg: color-mix(in oklch, <hue> 40%, var(--foreground-default))`
  - Measured in Chromium, light / dark: cyan 7.7 / 7.7, claret 9.8 / 6.3, midnight 10.5 / 5.7, emerald-dark 9.0 / 6.9, plum 6.3 / 8.7, rose 7.1 / 8.2, emerald 6.3 / 8.8, jordy 6.0 / 9.0. Lowest is 5.7:1. Weight stays 600.
  - `@you` keeps `--hl` / `--hl-fg`. `#channel` keeps `--secondary-default` / `--foreground-subtle`. A person's name in the sidebar preview ("Maya:") stays plain text.
- **@ and # suggestion rows** and **To picker rows**: the 20px avatar already carries the hue; no change.
- **Reactions**: no hue. A reaction belongs to several people. "Mine" keeps `--hl-soft` with the `--hl-ring` border; the count turns `--foreground-default` so the pill reads as pressed.

Do not use the hue for text under 11px, for borders, or for anything that is not that person.

### 4.2 One warm tint

One warm colour, used only inside illustrations:

- `--warm: #E39A3B`
- `--warm-soft: color-mix(in oklch, var(--warm) 26%, var(--background))` light (#F8E2CA), `22%` dark (#3C2E1F).

It is the fill layer of every spot illustration (section 6), in place of Phosphor's 20% ink. It is never a text colour, a background for a control or a status. The private-channel amber comes from `--warning` and is unrelated; the two are never next to each other because illustrations only appear in empty states.

### 4.3 Accent variants

Nothing new depends on `--hl`, so the four accents keep working. The person-hue chip is independent of the accent, so a midnight accent next to a midnight person reads the same as today's avatar does. The toast check uses `--success` mixed into the toast's own background (`color-mix(in oklch, var(--success) 55%, var(--background))` on the ink toast, 6.1:1; `80%` on the dark theme's paper toast, 7.2:1), not the accent.

## 5. Motion

Three ideas: instant for the things you do constantly, quick ease-out for presses and toggles, and a small spring for the handful of moments that deserve it. All durations and curves are tokens; none is written in a component.

| Token | Value | Use |
| --- | --- | --- |
| `--duration-fast` | 150ms | unchanged: press scale, hover colour, focus ring |
| `--duration-pop` | 220ms | reaction pop, toggle fill, resolve check |
| `--duration-appear` | 240ms | toast, popover, palette, card and empty-state entrance |
| `--duration-exit` | 150ms | every exit |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | presses, toggles, entrances, exits (replaces the keyword `ease-out`) |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | the three pops below only; overshoots about 8% |
| `--press-scale` | 0.96 | unchanged |
| `--pop-scale` | 1.12 | the peak of a pop |

Where each applies:

- **Press**: `scale` to `--press-scale` over `--duration-fast` `--ease-out`, release springs back over `--duration-pop` `--ease-spring`. Never when disabled.
- **Toggle to active** (subscribe, pin, reaction I add): the filled icon scales 0.8 → `--pop-scale` → 1 over `--duration-pop` `--ease-spring` with an opacity cross-fade from the outline icon. Toggling off just cross-fades over `--duration-fast`. Both icons stay in the DOM; only `transform` and `opacity` animate.
- **Reaction pop**: the emoji inside the chip scales 1 → `--pop-scale` → 1 over `--duration-pop` `--ease-spring` when my reaction lands. Other people's reactions arriving do not animate.
- **Resolve** (row button, header button, Tidy up): the check fills and pops as above; the row fades to 0 over `--duration-exit` and is removed. Height is never animated; the list reflows after removal, as it does today. The undo toast appears at the same time.
- **Toast**: enter `translateY(8px)` → 0 with opacity over `--duration-appear` `--ease-out`; exit opacity over `--duration-exit`. A replacing toast cross-fades, it does not slide again.
- **Appear** (popover, menu, palette, send-check bar, catch-up card, grouping card, empty state): opacity 0 → 1 and `scale` 0.98 → 1 over `--duration-appear` `--ease-out`, origin at the anchor. Exit opacity only. The catch-up and grouping cards must not change height while entering (performance 3.3): they are laid out at full size and only fade.
- **Empty state**: the illustration, title and action enter staggered 80ms apart with opacity and `translateY(6px)`, once, when the state first appears. Not on every filter change: if the empty state was visible less than a second ago it just shows.
- **Theme switch**: unchanged (transitions suppressed for two frames).

Never animated: row hover, selected row, tab switch, tab hover, typing, scrolling, list reorders, nav item hover and active. These stay instant as `docs/performance.md` 2.3 and 4.1 require. Only `transform` and `opacity` are animated anywhere; `will-change` is set on toasts and popovers while they enter and removed after.

Reduced motion: `--duration-pop`, `--duration-appear`, `--duration-exit` and the stagger collapse to 0.01ms through the token (same pattern as `--duration-fast`), `--press-scale` and `--pop-scale` become 1, and translate distances become 0. Opacity cross-fades remain so state changes still have a visible cue; the filled icon, the toast text and the resolve check are the static cues.

## 6. Spot illustrations

A small set of drawings in the same language as the seated-j logo and Phosphor regular: one colour (`--foreground-subtle` via `currentColor`), stroke 4 units on a 64-unit grid (the same 1/16 ratio as Phosphor regular), round caps and joins, filled dots, and one flat layer in `--warm-soft` behind part of the drawing. No faces, no gradients, no second line weight. Rendered at 96–120 px wide, 64–72 px tall, as inline SVG components in `packages/ui/src/illustrations/`.

The seated j (the `bow` concept: head forward, spine curving into a flat lap) is the character. It appears in two of the drawings; the others are objects only, so the figure stays special.

| Name | Drawing | Where |
| --- | --- | --- |
| `caught-up` | The seated j with a tablet on its lap, tilted toward the reader, a check on the screen (see the mock) | Sidebar: Unread filter on, nothing unread. For you: no cards |
| `nothing-here` | A tray with two faded rows resting in it | Sidebar: a filter or scope hides everything; All topics: no match; Browse and To picker: no match |
| `nothing-open` | A tablet on its own, blank, with the j's two reply dots beside it | Workspace with no tabs |
| `no-results` | A magnifying glass over two short rows | ⌘K: no matches |
| `juno` | The seated j alone, 40 px, no tablet | Juno chat empty state, above "What do you need?"; also the assistant's 28px avatar mark, there without the warm layer |

Empty states keep their structure from SPEC §16: say why it is empty, offer one next step. The illustration sits above the title with 14px below it. The `EmptyState` primitive gains `illustration?: IllustrationName`; the `list` variant shows it at 96 wide, the `workspace` variant at 120.

## 7. Copy voice

Keep SPEC §17: sentence case, verb-first buttons, no emoji in chrome, undo over confirm, "Resolved · title · Undo" toasts. Within that, write like a calm colleague: say what happened, in the order the reader cares about, with ordinary words. Contractions are fine. No exclamation marks, no "oops", no "awesome".

| Where | Before | After |
| --- | --- | --- |
| Toast, resolve | Resolved · Postgres 16 migration plan | unchanged (the spec fixes this format) |
| Toast, copy | Prompt copied | Copied the prompt |
| Toast, follow-up | Follow-up done | Marked as done |
| Toast, ignore | Ignoring #deploys | Hiding #deploys from now on |
| Sidebar empty, unread filter | No unread topics / Your filters are hiding everything. Older and resolved topics are in All topics. | You're all caught up / Nothing unread right now. Older and resolved topics live in All topics. |
| Sidebar empty, filtered | No recent topics here / Your filters are hiding everything. | Nothing here with these filters / Older and resolved topics live in All topics. |
| Sidebar empty, nothing recent | No recent topics here / Topics with activity in the last 7 days show up here. | It's quiet / Topics with activity in the last 7 days show up here. |
| Workspace empty | Nothing open / Pick a topic, or press ⌘K to find one. | Nothing open yet / Pick a topic on the left, or press ⌘K. |
| For you empty | Nothing right now. | Nothing for you right now / Juno adds a card here when something needs you. |
| All topics empty | No topics match these filters. | No topics match / Try fewer filters. [button: Clear filters] |
| ⌘K empty | No matches. | No matches for "staging" / Try a word from the message, or a person. |
| Juno chat empty | What do you need? | unchanged |
| Juno error | Couldn't reach the assistant. Try again in a moment. | Juno didn't answer. Give it a moment and try again. |
| Sign-in, first run | Engine ready to sign in | Hi, I'm Juno / Sign in to Slack and I'll sort your conversations into topics. Nothing is sent without you. [button: Sign in to Slack] |
| Sign-in, session expired | Engine session expired | Slack signed you out / Sign in again to pick up where you left off. [button: Sign in] |
| Offline | Engine offline | You're offline / Juno shows what it has and catches up when you're back. |
| Rate limited | Engine rate limited | Slack asked us to slow down / Juno will catch up in a minute. |
| Catching up | Engine catching up, 12 of 40 | Catching up, 12 of 40 channels |
| Send failed | | Couldn't send that. Your message is still in the composer. [button: Try again] |

Rules that fall out of the table:

- Titles say what is true in four words or fewer. Bodies say why, or what happens next, in one sentence.
- Name Juno as "Juno" or "I" only on the Juno and sign-in surfaces. Everywhere else the app has no voice.
- Never blame the user ("You have no…"). Never apologise ("Sorry"). State and move on.
- Errors name the thing that failed and what is kept safe (the draft, the data), then one action.
- Progress copy counts real things (channels, messages), never percentages.

## 8. What must not change

- **Density and layout.** Row heights, paddings, the 384px sidebar, the 800px reading width, the 44px bars. Pills are the same height as the tags they replace.
- **Calm by default.** Unread counts stay soft grey. No red, no accent-coloured badges, no dots that pulse. The For you count stays a quiet chip.
- **The AI rules.** AI still shows nothing unless confident, never writes for you, never adds labels to the sidebar, never sends without a click. Duotone sparkles do not make AI more visible; they only mark where it already appeared.
- **Native feel.** Arrow cursor everywhere, native menus, instant rows and tabs, keyboard reach, 4.5:1 text, reduced motion respected, no pointer cursor.
- **Type.** Inter and Instrument Serif, same roles and sizes. No display face, no rounded sans.
- **Context tints.** Public, private and DM pills keep their colours; only their radius changes.
- **Chrome has no emoji and no character.** The seated j appears in illustrations and the Juno surfaces only, never in the sidebar, the header or a toast.

## 9. Edits to tokens.md

Apply these in `docs/design/tokens.md` and `packages/tokens/src/tokens.stylex.ts` together.

1. **§1.6 Person colours**: add the chip mix. "Mention chips: background `color-mix(in oklch, <hue> 16%, var(--surface-default))`, foreground `color-mix(in oklch, <hue> 40%, var(--foreground-default))`, weight 600. Lowest measured contrast 5.7:1 (midnight, dark). Tokens `--person-chip-bg-mix: 16%`, `--person-chip-fg-mix: 40%` beside the avatar mix (`24%` / `62%`)."
2. **§1.5 Status**: add `--warm: #E39A3B` and `--warm-soft` (26% light, 22% dark over `--background`) with the note "illustration fill only; never text, never a control".
3. **§1.5 Status**: add the toast check colour: `--toast-success: color-mix(in oklch, var(--success) 55%, var(--background))` light, `80%` dark.
4. **§4 Radii**: add `--radius-tag: 999px` and `--radius-pill: 999px`; change `--radius-xl` 10 → 12 and `--radius-2xl` 12 → 14; add `--radius-toast: 14px`; move "Mention chip" from `--radius-xs` to `--radius-tag`; move nav and filter buttons from `--radius-md-plus` to `--radius-lg`. Update the use column of `--radius-md` to drop tags, chips, pills, reactions and the scope chip (they move to `--radius-tag` / `--radius-pill`). Keep the nesting rule paragraph; add "a label is a pill, a control or container is a rounded rectangle; pills never nest in pills".
5. **§5 Icons**: replace the paragraph. "Phosphor (`@phosphor-icons/react`). Weight by size: `bold` at 12–14, `regular` at 15–20. `fill` marks active and selected states. `duotone` only for the Juno nav item, AI sparkles, For you card kinds and illustrations. Sizes: 12 (badges, chip close), 13 (row meta, tags, tab close), 14 (pills, cards, thread link, catch-up sparkle), 15 (tab icon), 16 (nav, menu items, buttons, title sparkle), 18 (icon buttons, hover toolbar, palette rows, send), 20 (attach, palette search). Tab icons sit at 0.75 opacity. Remove `--icon-stroke` and `--icon-stroke-small`; Phosphor is filled paths." Add `--icon-20` and drop `--icon-11`.
6. **§8 Motion**: replace the table with section 5 of this document: `--duration-fast` 150, `--duration-pop` 220, `--duration-appear` 240, `--duration-exit` 150, `--ease-out cubic-bezier(0.2, 0, 0, 1)`, `--ease-spring cubic-bezier(0.34, 1.4, 0.64, 1)`, `--press-scale` 0.96, `--pop-scale` 1.12, the reduced-motion collapse for all of them, and the "never animated" list. Replace the closing sentence ("No enter/exit animations… cap it at 150ms") with "Entrances are 240ms, exits 150ms, pops 220ms; rows, tabs and typing never animate."
7. **§10 Spec overrides**: add the row "Lucide outline icons → Phosphor (this document §2)" and "Radius 6 tags → pills".
8. **§2.2 Type roles**: no change. Note under the table that illustrations are 96–120px wide and sit 14px above the empty-state title.

Related doc edits for the implementer: `primitives.md` §1 (Icon API from 2.4), §5 (Chip radius), §6 (ContextPill radius), §14 (toast check and radius), §15 (EmptyState `illustration`), and the shared conventions line "Icons: Lucide". `inventory.md` §2.6, §16 and §17 take the copy from section 7. SPEC §16 "Icons" and "Radii" lines change to Phosphor and 6–14px; the owner should confirm that edit since SPEC is his.

## 10. Open for the owner

- Pills on the context pill make private (amber) and DM (blue) read a little louder than the square version. The mock keeps them; say if the square pill should stay for context only.
- `--radius-xl` 10 → 12 touches rows, cards and tiles at once. The alternative is to change only tiles and the toast and leave rows at 10.
- The sign-in copy introduces "I'm Juno". If the app should never speak in the first person, use "Sign in to Slack and Juno will sort your conversations into topics."
- Whether the Juno tab icon should be `fill` when active like the other nav items, or stay duotone always so Juno is always marked as the one AI surface. The mock uses duotone.
