# Home merged with New chat, round 4

The owner kept round 3's compact columns and asked for:

- The greeting with its scene back in every state ("Morning, Tushar." by time of day), with no count line.
- A "Recent" label before the columns.
- The destination chip on the first line when the text wraps.
- A second layout with the recents just above the composer, on its left edge.
- All topics moved from the sidebar's nav list into the title bar, in the New chat button's place.

Code:

- `packages/views/src/HomeCalm.tsx` and `HomeCalm.fixtures.tsx` (gallery `HomeCalmA`, `HomeCalmB`).
- `HomeComposer`'s `chipAtTop` in `HomeWrite.tsx`.
- `Sidebar`'s `allTopicsInTitlebar` (fixtures under "Unified Home").
- `IconButton`'s `current` (`primitives.md` §3).

Screenshots are from `GALLERY_SHOTS_ONLY=HomeCalmA,HomeCalmB,Sidebar pnpm gallery:shots`.

## What both layouts share

- **The greeting:** the scene over "Morning, Tushar." (Morning, Hello, Evening or Still up by time of day, and Happy Friday, as Home does today), in every state. There is no count line under it; the rows are the count. Caught up, the caught-up scene over "All caught up."
- **What needs you:** Home's rows, 24px under the greeting.
- **Recents:** one quiet "Recent" section label, then people on the left and channels on the right, five each. The label sits on the edge of the rows' marks. One label serves both columns: they are one group split by kind, and faces against channel art already say which is which, so a second label would only repeat that. Private channels keep their lock. Below 400px of width the columns stack.
- **The composer:** round 2's, unchanged, except that the chip now stays on the first line when the text wraps. The send button stays on the last line, as in a topic composer (`Composer` lines its controls up on the last line; the chip opts out with `align-self: flex-start`). The topic composer's attach button also stays on the last line, so only the chip moves.

## The two layouts

States, light and dark, in `A-centre/` and `B-above-composer/`:

| State | File |
| --- | --- |
| Items waiting | `items-waiting-{light,dark}.png` |
| Caught up | `caught-up-{light,dark}.png` |
| Writing, one line | `writing-{light,dark}.png` |
| Writing, three lines, chip on the first | `writing-multiline-{light,dark}.png` |
| The `@` list open | `at-person-{light,dark}.png` |
| Narrow, 560 | `narrow-{light,dark}.png`, `narrow-caught-up-{light,dark}.png`, `narrow-multiline-{light,dark}.png` |

**A · Centred.** Greeting, rows and recents in one centred 480px column, and the composer at the bottom. There is one axis. The recents' place depends on how many rows wait: with three rows they sit lower than when caught up.

**B · Above the composer.** The greeting and rows stay centred. The recents sit just above the composer, starting on the field's left edge, so the place you pick a destination is next to the place you write. They do not move when rows come and go: caught up or not, they keep the same place above the field. At 560 the field's edge and Home's column almost meet, and B looks like A. Caught up, the centred scene over a left-aligned block reads as two groups, what is new and where to write, not as a misalignment.

## Recommendation: B

- **Proximity** (better-layout: group what is used together): the recents and the chip are both "where it goes", and B puts them together. When you press a recent, the chip it changes is right under it.
- **Stable placement:** the recents never move between states, and the composer never moves. In A the recents move with the number of rows.
- **Calmer middle:** the centre of the page holds only the greeting and what needs you. Caught up, it is the scene and one line.
- **The cost:** two edges on a wide window, the centre axis above and the field's left edge below. The recents are anchored to the composer, which is the strongest edge on the page, so it reads as deliberate. If the owner prefers one axis, A is the fallback; everything else is the same.

## Sidebar title bar

`sidebar-top/` holds the sidebar's top, light and dark:

- `all-topics-button`: Home current.
- `all-topics-current`: All topics current.
- `all-topics-tooltip`: the tooltip.

The title bar reads: the sidebar button, Back, Forward; then Search, **All topics**, the avatar. All topics uses the list icon it has today (`ListBullets`), a 30px ghost `IconButton` like Search, with the tooltip "All topics". It opens on mouse down, and ⌘ opens it in a new tab, as the nav item does. Right-click opens the same page menu. While All topics is the current tab it takes the nav's active look: the accent nav fill, the accent text colour and the filled icon, with `aria-current="page"`. The nav list keeps Home and Juno. All topics has no keyboard shortcut today; its ⌘K row stays.

## Removal plan (round 3's, updated)

Everything in `../round-3/README.md` "Final removal plan" stands, with these changes:

- **Home** shows the greeting and its scene in every state, with no count line ("Two things want you" goes). Then what needs you, then layout B: "Recent" over people and channels, five each, just above the composer.
- **The composer chip** stays on the first line when the text wraps; the send button on the last.
- **The sidebar title bar:** the New chat button's slot takes All topics (`IconButton` with `current`). The nav list's All topics item goes, leaving Home and Juno. ⌘K's All topics row stays. `Sidebar`'s `allTopicsInTitlebar` flag goes when this is built; it becomes the only layout.
- **Docs that change, in addition:**
  - SPEC §5 items 1 and 2: the title bar holds Search, All topics and the avatar; the nav holds Home and Juno.
  - SPEC §11 (getting to All topics).
  - SPEC §12 (the greeting, "Recent", layout B).
  - `inventory.md` §1 (title bar and nav).
- **E2e tests that change, in addition:**
  - The driver's `AllTopicsPane.navItem` (`e2e/driver/juno.ts`) points at the title bar's "All topics" button instead of the Pages nav item. Every test that opens All topics goes through it.
  - `all-topics.spec.ts`'s `aria-current` check still holds, because the button sets it.
  - `layout-shift.spec.ts` for the shorter nav.
  - The gallery `Sidebar` shots.
