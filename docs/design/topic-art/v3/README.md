# Topic art, round 3: colour

The owner, looking at the dark sidebar with nine topics: the art feels monotonous although each drawing is distinct and good. This folder measures why and compares five colour directions on the same sidebar. Round 2 (`../v2/`) chose the drawings, the vocabulary and no container; none of that changes here.

## Files

| File | What it is |
| --- | --- |
| `directions.mjs` | The directions as exact values per theme, hue and role. |
| `oklch.mjs` | OKLCH to sRGB, the sRGB chroma limit and WCAG contrast, no dependencies. |
| `metrics.mjs` | Prints the contrast table below. |
| `render.mjs` | Screenshots the gallery's `Sidebar`, `Art`, `every-row` state under each direction, in light and dark, with the direction's values injected as CSS variables. Also draws the same recipes at 16px and 20px, and the privacy state for directions 0 and 4. |
| `sheet.mjs` | Puts the six sidebars side by side: `renders/compare-light.png`, `renders/compare-dark.png`. |
| `renders/` | `<direction>-sidebar-<theme>.png`, `<direction>-small-<theme>.png` (16px row, then 20px), `<direction>-privacy-<theme>.png`. |

To re-run from the repo root: `pnpm --filter @juno/gallery build`, then `node docs/design/topic-art/v3/render.mjs` and `node docs/design/topic-art/v3/sheet.mjs`.

The sidebar is a new gallery state, `Sidebar` › `Art` › `every-row` (and `every-row-privacy`): fourteen topics from an engineering-heavy workspace, every one with its art. The recipes are round 2's art-directed drawings for the same invented topics, so the hues are the ones the model picked.

## Why the set reads as one texture

Measured on `0-now-sidebar-dark.png` and the tokens on main. Four causes, in order of how much each one costs:

1. **The hues cluster, and the cause is the prompt, not a hash.** The model picks the hue from a mood guide ("teal and sky for systems, amber and coral for money and urgency ..."). Over round 2's 32 confident art-directed drawings it picked coral 8, teal 6, amber 6, periwinkle 6, sage 3, sky 2, plum 1 and olive 0. In an engineering workspace most topics are "systems", so the fourteen rows here are five teal, three coral, three periwinkle, two amber and one sky. The owner's teal, slate and lavender is this.
2. **The line is grey.** Ink is most of a drawing's pixels, and its chroma is 0.022 in light and 0.028 in dark at one lightness for every hue (0.43 and 0.78). At that chroma a teal line and a periwinkle line are the same light grey. Hue shows only in the accent (chroma 0.085 in dark, a dot or two) and the soft fill.
3. **In dark, the fills read as holes.** The soft fill is L 0.36 at chroma 0.032 on a sidebar at L 0.19. Darker than the line and nearly grey, it reads as the inside of an outline, not as a coloured surface, so every drawing is a pale outline round a dark interior.
4. **Every hue has the same lightness and chroma.** Real palettes let amber sit high and violet sit low, and set chroma relative to what each hue can reach. A flat 0.022 is a large share of teal's range at L 0.43 and a tiny share of periwinkle's.

The brief also guessed that every drawing being one centred outline glyph of one weight and size adds to it. That is true, but it is round 2's decision (no container, one shared line) and it is what keeps the list calm. With colour fixed, the shape variety the drawings already have shows again, so this round leaves the shapes alone.

## The directions

Each is a full set of `--art-<hue>-<role>` values in `directions.mjs`. Chroma written as "share" is that share of the most chroma sRGB holds at that lightness and hue, then capped.

| | Direction | What changes |
| --- | --- | --- |
| 0 | Now | The tokens on main. |
| 1 | More chroma | Same lightness. Ink chroma 0.06 light and 0.075 dark, soft 0.06 and 0.055, accent 0.13 and 0.11. Dark gets more ink chroma than light: a thin pale line on near-black needs more to read as a colour. |
| 2 | Per-hue lightness | Direction 1 with lightness lifted per hue (amber +0.05, olive +0.04, sage +0.02, teal +0.01, coral 0, sky -0.02, plum -0.03, periwinkle -0.04, halved for ink and fills) and chroma as a share of each hue's maximum. |
| 3 | Tinted ground | Direction 2 on a rounded square in the hue (radius 10 at 40px, drawing at 80%): light L 0.935, dark L 0.285. |
| 4 | Two-tone | Direction 2 with the colour moved into the mass: the soft fill becomes a real mid-tone in the hue (light L 0.83, dark L 0.50, chroma up to 0.085) and the line takes the hue too. |
| 5 | Two-tone, hues spread | Direction 4, with each drawing in the hue its Tide placeholder already has (from the topic id) instead of the model's pick. |

## Measured

Contrast against the sidebar (`--background-subtle`: #FAF8F3 light, #151411 dark), from the declared values. Ranges run over the eight hues. The ink must stay under an unread row's preview (`--foreground-secondary`) and far under the title. A read row's preview is the muted grey (4.8:1 light, 6.9:1 dark); the ink sits above that today and still does.


### Light: title 15.0:1, unread preview 8.3:1, unread count text 5.7:1 on the sidebar

| Direction | Ink contrast (min to max) | Ink chroma | Accent contrast | Accent chroma | Soft chroma |
| --- | --- | --- | --- | --- | --- |
| Now | 7.5 to 7.7 | 0.022 to 0.022 | 3.5 to 3.9 | 0.100 to 0.100 | 0.038 to 0.038 |
| More chroma | 7.4 to 7.9 | 0.060 to 0.060 | 3.5 to 4.0 | 0.106 to 0.130 | 0.056 to 0.060 |
| Per-hue lightness | 6.5 to 7.9 | 0.048 to 0.075 | 3.1 to 4.5 | 0.081 to 0.140 | 0.025 to 0.070 |
| Tinted ground | 6.5 to 7.9 | 0.048 to 0.075 | 3.1 to 4.5 | 0.081 to 0.140 | 0.034 to 0.075 |
| Two-tone | 6.5 to 7.9 | 0.052 to 0.080 | 3.4 to 4.9 | 0.083 to 0.140 | 0.048 to 0.085 |
| Two-tone, hues spread | 6.5 to 7.9 | 0.052 to 0.080 | 3.4 to 4.9 | 0.083 to 0.140 | 0.048 to 0.085 |

### Dark: title 15.5:1, unread preview 9.9:1, unread count text 7.5:1 on the sidebar

| Direction | Ink contrast (min to max) | Ink chroma | Accent contrast | Accent chroma | Soft chroma |
| --- | --- | --- | --- | --- | --- |
| Now | 9.1 to 9.3 | 0.028 to 0.028 | 7.2 to 7.7 | 0.085 to 0.085 | 0.032 to 0.032 |
| More chroma | 8.9 to 9.5 | 0.075 to 0.075 | 7.1 to 7.8 | 0.110 to 0.110 | 0.055 to 0.055 |
| Per-hue lightness | 8.3 to 9.8 | 0.069 to 0.085 | 6.5 to 9.1 | 0.091 to 0.115 | 0.036 to 0.060 |
| Tinted ground | 8.3 to 9.8 | 0.069 to 0.085 | 7.0 to 9.7 | 0.094 to 0.115 | 0.041 to 0.065 |
| Two-tone | 8.3 to 9.8 | 0.063 to 0.080 | 7.8 to 9.4 | 0.087 to 0.115 | 0.054 to 0.085 |
| Two-tone, hues spread | 8.3 to 9.8 | 0.063 to 0.080 | 7.8 to 9.4 | 0.087 to 0.115 | 0.054 to 0.085 |

- Every direction keeps ink under the unread preview and far under the title in both themes. Directions 2 to 5 were tuned for that: the per-hue lift is halved for ink, and ink starts at L 0.445 light and 0.775 dark.
- The unread count stays the most saturated thing in the row. Its text is chroma 0.146 in dark and 0.165 in light; the art's accent tops out at 0.14 light and 0.115 dark, on a dot or two.
- Coral art shares its hue angle with the default coral accent (32 against 32 to 34). That was true before; with more chroma, a coral drawing beside a coral count is the case to watch. In the renders the count still reads as the count because it is a filled pill with a number, and the drawing's coral is mostly the pale soft fill.
- Privacy mode blurs previews and leaves the art alone (`4-two-tone-privacy-*.png`). With the previews blurred the art carries a little more weight, and still sits under the title.
- At 16px (`*-small-*.png`) only the silhouette and the soft fill survive, so the fill is what carries the hue. Direction 4 and 5 read as coloured glyphs at 16; direction 0 reads as grey.

## What the renders show

- **1 · More chroma** helps most in light, where the lines go from grey-brown to clearly teal, sky, amber. In dark it is a small step: the lines tint, the dark holes stay.
- **2 · Per-hue lightness** adds a little: amber and olive lift, periwinkle settles. Alone it is subtle, and it is what makes the other directions feel like a palette rather than one colour rotated.
- **3 · Tinted ground** is the calmest rhythm in light, and the owner already ruled containers out in round 2. In dark the ground at L 0.285 makes each drawing smaller and dimmer, and fourteen tinted boxes are the heaviest thing in the list. Not recommended.
- **4 · Two-tone** is the biggest change from colour alone. In dark the fills become surfaces in the hue, so each drawing reads as a coloured object, not an outline. The list stays calm because the fills stay mid-tone and the lines stay under the text. The teal cluster is still there: five of fourteen rows are the same teal object family.
- **5 · Two-tone, hues spread** is the only one where the list stops reading as one texture. Neighbours differ, all eight hues appear, and the art matches the pebble it replaces, so the cross-fade keeps its colour. The cost is the model's mood hue: "coral for urgency" goes. Users could not read that meaning from the hue anyway, and nothing else uses it.

## Recommendation

Direction 5: the two-tone palette, with each drawing taking its topic's pebble hue.

- Colour alone (4) fixes "too dull" but not "too similar"; the hue clustering is the larger cause and only moving the hue choice out of the mood guide fixes it.
- A prompt change could spread hues too, but it needs a model pass to verify, changes the task version (so every stored drawing redraws), and the model would still lean on its favourite hues. The topic id is deterministic, free, and already the pebble's hue.
- The drawing, its recipe and the stored row do not change. The recipe's `data-hue` is still parsed and stored (Redraw quotes it); the renderer is told which hue to paint with.

The exact token values are in `docs/design/tokens.md` 1.9 and `packages/tokens/src/tokens.stylex.ts` / `themes.stylex.ts`.
