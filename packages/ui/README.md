# @juno/ui

Dumb, accessible primitives. StyleX plus `@juno/tokens` only; no app state, no data imports, no product words (`Chip`, not `UnreadBadge`). The set is described in `docs/design/primitives.md`; this file covers the conventions that are easy to miss.

## Conventions

- No `cursor: pointer`, ever. The body sets the arrow cursor; inputs set the text cursor.
- Hover styles only under `@media (hover: hover)`, nested with `default: null` so they fall back to nothing.
- Press feedback is `scale: var(--press-scale)` on `:active`, never on a disabled control (`pointer-events: none` makes `:active` impossible).
- The focus ring shows on `:focus-visible` only: 2px `--focus-ring`, offset 2px (inset for tabs, segments and rows that sit flush).
- Transitions are 150ms (`--duration-fast`) on colour, shadow, opacity and scale, and collapse under `prefers-reduced-motion` through the token itself.
- Chrome text is not selectable. `Text selectable`, `Textarea`, `TextField` and `CodeBlock` opt in.
- Icon-only controls take a required `label`. Icons are `lucide-react` components passed as props (`icon={Hash}`), never looked up by name, so only the icons used are bundled.
- Components do not accept `style` or `className`. A few layout containers (`Text`, `Surface`) take `sx` for StyleX styles from the owner; use it for layout, not colour.

## Mouse-down activation

Things that navigate (`ListRow` with `onSelect`, `Tab`, `OptionRow`) activate on `pointerdown`, not `click`, so the app answers the moment the button goes down. The shared handlers live in `src/internal/activate.ts`:

- Primary button only. The secondary button goes to `onContextMenu`; ctrl-click is left alone because on macOS it is the context menu.
- ⌘, shift and alt are passed through in the `ActivateEvent` so the owner can open in a new tab.
- Enter and Space activate from the keyboard; a click with `detail === 0` (assistive technology) activates too. Real clicks are ignored because the press already fired.
- A press that starts inside a nested control (a Resolve button, a close button, a link) is ignored; the control handles itself.
- Pressing and dragging away is harmless: the activation already happened on the press and nothing waits for the release.
- Touch pointers wait for the click so a scroll gesture is not a navigation.

These elements have **no transition on their background**. Selected and active states change in the same frame as the press; hover is instant too (the design allows up to 150ms, instant is better). Hover changes only colour and background, never size, border width or shadow, so nothing forces layout.

## Fixtures and the gallery

Every component exports `<Name>.fixtures.tsx` built with `defineFixtures(Component, { name: fixture(props) })`, and `src/fixtures.ts` collects them under `@juno/ui/fixtures`. The gallery (`apps/gallery`) turns each entry into a route and a screenshot. `@juno/views` registers its fixtures the same way.
