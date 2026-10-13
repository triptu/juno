# @juno/ui

Dumb, accessible primitives. StyleX plus `@juno/tokens` only; no app state, no data imports, no product words (`Chip`, not `UnreadBadge`). The set is described in `docs/design/primitives.md`; this file covers the conventions that are easy to miss.

## Conventions

- No `cursor: pointer`, ever. The body sets the arrow cursor; text inputs and textareas set the text cursor; checkboxes, ranges and selects keep the arrow. The gallery's behaviour spec checks every fixture for this.
- Hover styles only under `@media (hover: hover)`, nested with `default: null` so they fall back to nothing.
- Press feedback is `scale: var(--press-scale)` on `:active`, never on a disabled control (`pointer-events: none` makes `:active` impossible).
- The focus ring shows on `:focus-visible` only: 2px `--focus-ring`, offset 2px (inset for tabs, segments and rows that sit flush).
- Transitions are 150ms (`--duration-fast`) on colour, shadow, opacity and scale. Entrances (Toast, Popover, EmptyState) are 240ms (`--duration-appear`) and pops (an IconButton toggle filling, a reaction Chip with `pop`) 220ms (`--duration-pop`) on the spring. Every duration, scale and distance collapses under `prefers-reduced-motion` through the token itself, so no component has a media query. Only `transform` and `opacity` animate; rows, tabs and nav items never do.
- `disabled` and `dimmed` share one look (`--opacity-disabled`); dimmed stays focusable and sets `aria-disabled`.
- Chrome text is not selectable. `Text selectable`, `Textarea`, `TextField` and `CodeBlock` opt in.
- Icon-only controls take a required `label`. Icons are Phosphor components passed as props (`icon={Hash}`), never looked up by name, and imported one at a time from `@phosphor-icons/react/dist/icons/<Name>` (the root entry pulls the whole set into dev builds). `Icon` picks the weight from the size (bold at 14 and below, regular above); call sites name only `fill` (through `active`) and `duotone`.
- A person's colour comes from `hueForId(slackId)`; a channel's default look from `defaultChannelLook(channelId)`. Both are stable across lists and machines.
- `Avatar` takes `src` for a profile photo and never shifts layout: the box is sized up front and the initials stay underneath until the photo has loaded, or for good if it fails.
- Components do not accept `style` or `className`. A few layout containers (`Text`, `Surface`) take `sx` typed as `LayoutStyles`, which rejects colour and font properties, so it is layout only by construction.
- `Text` names its type role `variant`; `role` on any primitive is always the ARIA attribute.
- Sizes derive from one prop. `Button` has no radius, text or icon-size overrides; the sidebar nav item is `NavItem` and the quick filter is `Button variant="filter"`.
- Muted text never sits on a secondary fill. `ListRow selected` sets `--foreground-muted` to the subtle value on itself (a variable override in `stylex.create`, never a `createTheme`, which re-emits every colour of the group and would undo dark mode on that element).
- Primitives never know the theme: no media queries, no theme classes. `applyTheme(theme, accent)` in `src/theme.ts` is the one place that puts the `dark` and accent classes on `<html>`, sets `color-scheme` and suppresses transitions for two frames; apps reach it through `@juno/views`.
- Composer growth is `field-sizing: content` on the inline `Textarea`; nothing reads `scrollHeight` on a keystroke.

## Mouse-down activation

Things that navigate (`ListRow` with `onSelect`, `Tab`, `OptionRow`, `NavItem`) activate on `pointerdown`, not `click`, so the app answers the moment the button goes down. The shared handlers live in `src/internal/activate.ts`:

- Primary button only. The secondary button goes to `onContextMenu`; ctrl-click is left alone because on macOS it is the context menu.
- ⌘, shift and alt are passed through in the `ActivateEvent` so the owner can open in a new tab.
- Enter and Space activate from the keyboard; a click with `detail === 0` (assistive technology) activates too. Real clicks are ignored because the press already fired.
- A press that starts inside a nested control (a Resolve button, a close button, a link) is ignored; the control handles itself.
- Pressing and dragging away is harmless: the activation already happened on the press and nothing waits for the release.
- Touch pointers wait for the click so a scroll gesture is not a navigation.

These elements have **no transition on their background**. Selected and active states change in the same frame as the press; hover is instant too (the design allows up to 150ms, instant is better). Hover changes only colour and background, never size, border width or shadow, so nothing forces layout.

The gallery's `behaviour` project (`pnpm --filter @juno/gallery test:e2e`) drives the `ListRow/activation` fixture in a real browser to check each of these.

## Fixtures and the gallery

Every component exports `<Name>.fixtures.tsx` built with `defineFixtures(Component, { name: fixture(props) })`, and `src/fixtures.ts` collects them under `@juno/ui/fixtures`. The gallery (`apps/gallery`) turns each entry into a route and a screenshot. `@juno/views` registers its fixtures the same way.

A fixture's frame can ask the screenshot runner to put the component into a state first: `hover`, `press` (holds the primary button, with motion on so the press scale shows) and `focus` (keyboard focus, so the ring shows) each take a CSS selector inside the frame. Every primitive with such states has fixtures for them, so hover, pressed, focused and disabled are reviewed in light and dark like everything else.
