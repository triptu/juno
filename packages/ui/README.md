# @juno/ui

Dumb, accessible primitives. StyleX plus `@juno/tokens` only; no app state, no data imports, no product words (`Chip`, not `UnreadBadge`). The set is described in `docs/design/primitives.md`; this file covers the conventions that are easy to miss.

## Conventions

- No `cursor: pointer`, ever. The body sets the arrow cursor; text inputs and textareas set the text cursor; checkboxes, ranges and selects keep the arrow. The gallery's behaviour spec checks every fixture for this.
- Hover styles only under `@media (hover: hover)`, nested with `default: null` so they fall back to nothing.
- Buttons keep their geometry on press and toggle. Hover and press colours change at once. Disabled controls use `pointer-events: none`.
- The focus ring shows on `:focus-visible` only: 2px `--focus-ring`, offset 2px (inset for tabs, segments and rows that sit flush).
- Buttons have no transform transition or toggle pop. Toast and empty-state entrances use `--duration-appear`; menus and popovers open and close at once. Other motion uses only transform and opacity and collapses under reduced motion through the tokens.
- `disabled` and `dimmed` share one look (`--opacity-disabled`); dimmed stays focusable and sets `aria-disabled`.
- Chrome text is not selectable. `Text selectable`, `Textarea`, `TextField` and `CodeBlock` opt in.
- Tooltips come from the one `TooltipLayer` the app mounts at its root; an element asks for one with `tooltip(label, keys?)`, and `IconButton`, `EmojiButton`, `AvatarButton` and `Swatch` do it from their `label` (an IconButton's `shortcut` adds keycaps). Do not use `title` on a control; it stays only for cut-off text and content.
- Icon-only controls take a required `label`. Icons are Phosphor components passed as props (`icon={Hash}`), never looked up by name, and imported one at a time from `@phosphor-icons/react/dist/icons/<Name>` (the root entry pulls the whole set into dev builds). `Icon` picks the weight from the size (bold at 14 and below, regular above); call sites name only `fill` (through `active`). A duotone icon comes from `src/duotone.ts` (`SparkleDuotone`): the desktop build keeps the duotone weight only for the icons it imports, and `scripts/check-duotone.mjs` fails on the weight's name anywhere else.
- A person's colour comes from `hueForId(slackId)`; a channel's default colour from `hueForId(channelId)`. Both are stable across lists and machines.
- Initials and channel letters take `firstGrapheme(name)`, never `charAt(0)`: a name that starts with an emoji or another character outside the Basic Multilingual Plane would otherwise draw half a glyph.
- `Avatar` takes `src` for a profile photo and never shifts layout: the box is sized up front and the initials stay underneath until the photo has loaded, or for good if it fails.
- Components do not accept `style` or `className`. A few layout containers (`Text`, `Surface`) take `sx` typed as `LayoutStyles`, which rejects colour and font properties, so it is layout only by construction.
- `Text` names its type role `variant`; `role` on any primitive is always the ARIA attribute.
- Sizes derive from one prop. `Button` has no radius, text or icon-size overrides; the sidebar nav item is `NavItem` and the quick filter is `Button variant="filter"`.
- `ListRow minHeight={32} padding="navigation"` uses the sidebar navigation geometry: 12px inline padding, 8px leading gap, a fixed 20px leading slot and radius 12. Its body keeps inline accessories 4px from the label.
- Muted text never sits on a secondary fill. `ListRow selected` sets `--foreground-muted` to the subtle value on itself (a variable override in `stylex.create`, never a `createTheme`, which re-emits every colour of the group and would undo dark mode on that element).
- Primitives never know the theme: no media queries, no theme classes. `applyTheme(theme, accent)` in `src/theme.ts` is the one place that puts the `dark` and accent classes on `<html>`, sets `color-scheme` and suppresses transitions for two frames; apps reach it through `@juno/views`.
- `ReorderMotion` observes a keyed list beside its rows and slides them to their new places when the list reorders (FLIP on `transform` and `opacity`, `--duration-reorder`), only for changes its owner marks `animate` and only while the scroller is at its top. Its observer (`ReorderSnapshot.tsx`) and player (`reorderPlayer.ts`) load together on idle, without remounting the rows. The observer reads drawn positions in `getSnapshotBeforeUpdate`; hidden documents and hidden scrollers skip the work, and changes before then take their places at once. A rising row sets `--reorder-background` for its default fill, leaving hover and selection styles immediate. The sidebar's topic list uses it (SPEC 5, "Letting go").
- `TopicArt` is a topic's tile: the AI drawing when the topic has one (`recipe`), the Tide pebble seeded by the topic id until then. Both are inline SVG that `@juno/topic-art` rebuilds from a whitelist, inserted with `dangerouslySetInnerHTML` because it is our own markup and never model text; the recipe is parsed again here, so a stored text outside the vocabulary draws the pebble. Colours are the `art` tokens' CSS variables, so the string is theme-free. The box is 40, 20 or 16px from the first paint and the swap is a 240ms opacity cross-fade (`--duration-appear`, collapsed under reduced motion), so art arriving late moves nothing. There is no container.
- `Textarea` loads chip and markup drawing at mount in a separate chunk. Sending does not depend on the drawing chunk. The mirror uses the field’s direction; code blocks draw an inset edge without changing their geometry.
- Composer growth is `field-sizing: content` on the inline `Textarea`; nothing reads `scrollHeight` on a keystroke.
- Scroll containers are `ScrollArea`. Its gutter is always the 10px from `global.css`, even before the content overflows (`scrollbar-gutter: stable`), so the first overflow never narrows the content; `scrollbar="hover"` keeps the track and thumb transparent until the pointer is over the area by changing one colour variable, registered as not inherited so only the area is restyled, not the rows inside, so showing the thumb never moves content. The sidebar list uses it; other scroll areas adopt it by prop.

## Deferred components

`chunk(importer)` shares one import between idle or intent preloading (`load`)
and its components (`component`). A preloaded component renders in the same
commit on its first mount. `useReady()` lets an eager reserved placeholder fill
as soon as loading finishes without ever committing a Suspense fallback. Views and desktop containers use the same helper;
`@juno/views` re-exports it for containers.

`Popover` holds its whole floating panel behind Suspense. A cold chunk never
shows a short empty panel that grows when the content arrives. The panel
clamps to its pane when it mounts, including after a deferred load.

## Menu and popover triggers

Every menu or popover button declares `aria-haspopup`. `Button`, `IconButton`, `AvatarButton`, `EmojiButton` and `SelectButton` share `menuTriggerHandlers`; custom view buttons use it too. `expanded` on Button and IconButton implies a dialog trigger unless `aria-haspopup` says otherwise. Primary mouse-down invokes the trigger; its later click is ignored. Preventing the mouse-down default preserves focus in the panel. Keyboard and touch still activate on click; ↓ also opens. Ctrl-click and right-click keep their context-menu behaviour. Custom popovers require a separate press to select an item; native menus keep system drag selection.

## Mouse-down activation

Things that navigate (`ListRow` with `onSelect`, `Tab`, `OptionRow`, `NavItem`) activate on `pointerdown`, not `click`, so the app answers the moment the button goes down. The shared handlers live in `src/internal/activate.ts`:

- Primary button of the primary pointer only. The secondary button goes to `onContextMenu`; ctrl-click is left alone because on macOS it is the context menu.
- ⌘, shift and alt are passed through in the `ActivateEvent` so the owner can open in a new tab.
- Enter and Space activate from the keyboard, once per press: holding the key does not repeat. A click with `detail === 0` (assistive technology) activates too. Real clicks are ignored because the press already fired.
- A press that starts inside a nested control (a Resolve button, a close button, a link, or anything marked `data-no-activate`) is ignored; the control handles itself.
- Pressing and dragging away is harmless: the activation already happened on the press and nothing waits for the release.
- Touch pointers wait for the click so a scroll gesture is not a navigation.

These elements have **no transition on their background**. Selected and active states change in the same frame as the press; hover is instant too (the design allows up to 150ms, instant is better). Hover changes only colour and background, never size, border width or shadow, so nothing forces layout.

The gallery's `behaviour` project (`pnpm --filter @juno/gallery test:e2e`) drives the `ListRow/activation` fixture in a real browser to check each of these.

## Fixtures and the gallery

Every component exports `<Name>.fixtures.tsx`, and `src/fixtures.ts` collects them under `@juno/ui/fixtures`. `@juno/views` registers its fixtures the same way. The gallery (`apps/gallery`) shows one state at a time and screenshots each one.

Declare the states grouped under headings in product words:

```ts
export default defineFixtures(Component, {
  Data: {
    loading: fixture({ ... }),
    empty: fixture({ ... }),
    error: fixture({ ... }),
    long: fixture({ ... }),
  },
  Session: {
    expired: fixture({ ... }),
  },
  Interaction: {
    'row-hover': fixture({ ... }, { hover: '[role="button"]' }),
  },
  Overview: {
    'all-sizes': scene(() => <Row>...</Row>),
  },
}, { width: 720 }) // optional frame for every state
```

- A group key is the heading as the switcher shows it (`Data`, `Photo`, `In context`). A state key is kebab-case and shows in sentence case. Both become URL parts: `#/Component?__state=data/loading` (group id, then state key). Keys must be unique within a component; `defineFixtures` throws on a duplicate.
- Group by what the user sees (`Data`, `Session`, `Failure`, `Availability`, `Interaction`), not by prop name. `Overview` holds comparison sheets that put several states side by side.
- A bare `name: fixture(...)` at the top level still works; those states are listed first with no heading. Prefer groups.
- List only states the component's code can reach. If a fixture shows something production cannot produce, remove it; do not add a branch to the component to make it possible. Copy in a view's fixtures is the copy its container passes.
- A pending or loading state holds still. Never resolve a fixture with a timeout. For a thing that never arrives, point at a request the gallery server holds open (Avatar `photo/pending` uses `/__fixture/pending.png`); tests answer it when they need the arrival.
- A state's frame can ask the screenshot runner to put the component into a look first: `hover`, `press` (holds the primary button, with motion on so unwanted press motion is caught) and `focus` (keyboard focus, so the ring shows) each take a CSS selector inside the frame. Every primitive with such looks has states for them, so hover, pressed, focused and disabled are reviewed in light and dark like everything else. Do not add a `press` state for a disabled control: it cannot be pressed.
- The layout-shift test (`apps/gallery/shift.spec.ts`) hovers, presses and focuses every interactive element of every state and fails on any movement. Hover and focus may change colour, shadow and outline, never size, position or border width.
