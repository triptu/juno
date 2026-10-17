# Home in the sidebar title bar

The owner: "let's move home to an icon button as well on top, just left of the user avatar button."

SPEC §5 and §12 ("Getting there"), inventory §2.1 and primitives §3 (`IconButton current`) decide the details. The shots come from the Sidebar and Shell gallery fixtures (`GALLERY_SHOTS_ONLY=Sidebar,Shell pnpm gallery:shots`), light and dark. `before-*` is main before the change, `after-*` is this change.

| File | What |
| --- | --- |
| `*-sidebar-*` | The default sidebar: Home leaves the nav list and joins the title bar |
| `*-home-active-*` | Home is the current tab: the Home button takes the nav's active look, as All topics does |
| `*-all-topics-active-*` | All topics current, for comparison |
| `*-narrowest-*` | The narrowest sidebar: 280 before, 312 after |
| `*-full-screen-*` | Full screen, where the title bar starts at the sidebar inset |
| `*-settings-minimum-window-*` | The minimum window with Settings open and its list a rail; no title bar icon is current |
| `after-home-tooltip-*`, `after-home-focus-*` | The tooltip and the focus ring |

## What changed

- **Home is a 30px icon button** (`house`) between All topics and the avatar. It does what the nav item did: opens on mouse down, ⌘ for a new tab, right-click for Open in new tab, and pointer enter or focus warms `home.view` (`prefetchHome`). While Home is the current tab it takes the same `current` look as All topics. Its tooltip is "Home". Home has no shortcut, so the tooltip shows no keys.
- **No count or dot.** The Home item never had one. Home shows at most three things and its rows are the count (SPEC §12), so a mark on the button would only repeat what Home says when opened.
- **Spacing.** The icons stay 2px apart and the avatar 6px after the last icon, as before. The avatar keeps its 10px inset from the sidebar's edge.
- **Tab order** follows the DOM: Hide sidebar, Back, Forward, Search, All topics, Home, avatar, then Juno.
- **The narrowest sidebar is now 312px, up from 280.** The title bar needs 78 (traffic lights) + 94 (Hide sidebar, Back, Forward) + 128 (three icons and the avatar) + 10 (inset) = 310px, and at 280 the avatar was cut off. At 312 the two groups keep the same 2px of slack they had at 280. A saved width under 312 falls back to the default 384 on the next launch, and the other saved values are kept.

## The nav list with Home gone

The list now holds only Juno, a full-width row with its ⌘J hint and count, then the hairline. It reads as a deliberate entry point to the assistant rather than as a list, and it still holds Juno's unread count and busy sparkle, which a title bar icon would have no room for. Keep it as it is. If it looks lonely over time, the next step would be to move Juno into the title bar too, but that needs a place for the count and would crowd the narrowest width again, so that is not proposed here.
