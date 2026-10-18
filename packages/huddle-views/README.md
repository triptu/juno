# @juno/huddle-views

The huddle views (SPEC section 20, inventory 22): React components built from `@juno/ui` that take view models and callbacks and nothing else. Containers in `apps/desktop/src/renderer/containers/huddle/` will wire the huddle atoms and the media session to them (`docs/plans/huddles.md`, phase 3). Depends on `@juno/ui` and `@juno/tokens` only, so its view models are its own (`src/model.ts`); a container maps the contract's huddle routes onto them.

## Public API

- `HuddleBar`: the two-row card at the top of the sidebar while the user is in a huddle. Row one opens the huddle tab on mouse down (⌘ for a new tab): the place, the status line and the other people. Row two is `HuddleControls`. One height in every state. The Sidebar view needs a `top` slot under its title bar to place it (plan, seam 2); until then the gallery's `HuddleInSidebar` composition puts it there by hand.
- `HuddlePage`: the huddle tab. `state` is `in` (the controls), `out` (Join huddle or Switch to this huddle), `ended` or `failed`. Audio only it shows tiles; with shares it shows up to two shared screens and a line of people under them. `renderShare(id)` is where the container puts the video element, inside a `[data-huddle-video]` box that is a size container; fit it with `object-fit: contain`.
- `HuddleControls`: Mute, Share screen (only when `canShare`), Microphone and speaker with its menu, and Leave, in the bar's (`bar`) or the tab's (`island`) shape.
- `HuddleHeaderButton`: the Start huddle, Join, Switch and In huddle control for the right island of a channel's or DM's Main. Its narrow form follows the topic header's container query.
- `HuddleIndicator`: the green headphones after a Main row's title while a huddle runs there; `huddleIndicatorLabel(count)` is its name, for the row's own description.
- `HuddleDeviceMenu`: the menu's content, microphones, speakers and Reduce background noise. `systemDevice` is the id of "Same as system".
- `ScreenSourcePicker`: the Share screen sheet's panel, with the Screen Recording permission steps. The container places it in `SheetLayer` from `@juno/views`.
- `statusLine`, `sharingLine`, `placeLabel` (`look.ts`): the copy rules the bar and the tab share. `muteShortcut` is ⌘⇧Space; the app menu owns the accelerator. The tab's glyph is Phosphor's `Headphones`.

`src/index.ts` exports only what something imports today (`HuddleBar`, `HuddleDeviceMenu` and `HuddlePerson`, for the gallery), because knip's ratchet fails on an unused export. The integration adds each view's export when its container imports it. The tab page is split into `HuddlePage` (states and footer), `HuddlePageHeader` and `HuddleStage` (tiles, shares and the people line).

Each view has a `<View>.fixtures.tsx` next to it, registered in `src/fixtures.ts` and shown by the gallery as `@juno/huddle-views/fixtures`. `src/fixtures/data.ts` holds invented people and drawn screens; nothing comes from Slack.

## Must not

The rules of `@juno/views` apply (`check-deps` covers any `*-views/` directory): no `@juno/state`, `@juno/engine`, `@juno/store`, Electron, Node built-ins, Effect or `window.juno`; no state beyond local UI state; no raw colours or sizes (`check-tokens` covers this package); no `style` or `className` props; no `cursor: pointer`.

## Performance

The bar sits in the sidebar, so its updates must stay cheap while a call runs: the duration is a `ReactNode` the container ticks as a leaf, speaking is one outline colour per face (no reorder, no layout), and the bar's height never changes. Nothing here imports the Chime SDK; the container loads it on join.
