# Channel marks

Slack has no channel images, so Juno draws one per channel. This folder explores a deterministic generative SVG system: the seed is the channel id, the output is a small SVG that reads as a picture at 40px and as a distinct blob of colour at 14 to 16px. Exploration only; nothing here is wired into the app.

Files:

- `generator.js`: the reference generator. Plain JS, no dependencies. `mark(channel, options)` returns an SVG string for one (style, theme, size, seed).
- `sheet.html`: the contact sheet. Open it over `file://` or any static server; it loads `generator.js` and draws every family at 40px and 16px, light and dark, plus a sidebar mock in the C1 + D1 look and the semantic demo.
- `render.mjs`: screenshots each section of the sheet with Playwright through the installed Chrome. Run `node docs/design/channel-marks/render.mjs` from the repo root.
- `family-A.png` to `family-F.png`, `family-semantic.png`: the renders after the third pass.

## How the system works

Every family shares the same scaffolding:

- **Random stream.** FNV-1a hash of the seed string (the channel id by default) feeds a mulberry32 PRNG. Every choice below draws from that stream in a fixed order, so the same id always gives the same mark.
- **Palette.** Eight hue anchors in OKLCH, tuned slightly warm so they agree with the paper surfaces and the Coral accent: coral 32, amber 72, olive 112, sage 150, teal 185, sky 235, periwinkle 275, plum 320. Each mark picks a main hue and a partner hue. The partner is usually one step round the wheel (analogous), so a list of twenty marks stays calm; higher semantic energy allows a wider step.
- **Tonal ramp.** One hue gives five tones: `base`, `soft`, `mid`, `deep`, `pale`. In light the base is pale (L 0.88) and the shapes go deeper; in dark the base is deep (L 0.36) and the shapes go lighter. The silhouette is identical in both themes, only the direction of contrast flips, so a mark stays recognisable when the theme changes. Chroma is capped at 0.12 and reduced further when a colour falls outside sRGB.
- **Tile.** A 40 x 40 box clipped to a 16px radius, with a 1px inner edge at 7% black (light) or 9% white (dark) so the tile separates from a row that is hovered or selected. The radius scales with the box, so the 16px mark gets a 6.4px radius.
- **Small size.** Below 20px each family drops its smallest element (the focal dot, the third blob, the second halo). The real implementation renders two strings per channel, one per size.
- **Semantic layer.** A keyword table maps words in the name (`alerts`, `deploy`, `design`, `hiring`, `eng`, `product`, `random`, `sales`, `leadership`, `support`, `security`, `general` and their neighbours) to a hue, an energy (how far the partner hue may sit) and a motif (`rise`, `grid`, `soft`, `scatter`, `calm`). Each family reads the motif in its own way: Blocks narrows the template pool, Sunset keeps the sun below the horizon, Tide flattens the waves for `calm` and adds a sun for `rise`, Hills gives `calm` a single hill. An AI could fill the same three fields from name and purpose later; the shape of the bias stays.
- **Group DMs.** `mark(channel, { group: [hue, hue, hue] })` draws the Bloom composition from the participants' person hues (tokens 1.6) instead of a hashed hue, so a group DM reads as "those people" and sits between the photo avatars and the channel marks.

## The families

| | Family | Idea | Strengths | Weaknesses |
| --- | --- | --- | --- | --- |
| A | Bloom | Two or three soft radial blobs on a diagonal wash, with a deeper pool inside the big blob. | Closest to a photo, calm, reads as one colour at 16px. | Looks like a 2010s gradient orb; individual marks are hard to tell apart beyond hue. Costliest string (about 1.3 KB, four gradients). |
| B | Blocks | Bauhaus compositions on a 2 x 2 grid: quarter and half discs, a disc with a dot, bars, an arch, a diagonal. One of four rotations. | Most intentional and the most varied; clearly a "mark", reads at 16px by shape as well as colour; flat fills, about 540 bytes. | Flat colour is the least "image-like"; the bars template can read as a flag. Needs the chroma cap to stay calm. |
| C | Sunset | A sun with one or two halos sitting on a horizon, the ground in the deep tone. Sometimes flipped. | Strong single motif, warm, clearly friendly; good at 16px (two bands and a dot). | All marks share one silhouette, so distinctness comes from colour alone; the first pass with thin bands was stripy and muddy, now fixed with fat halos. |
| D | Terrazzo | Rounded chips in three tones on a jittered grid. | None that survived. | Dropped. Five to seven small chips turned to noise at 16px and the small dots read as status; three or four big chips overlapped into camouflage. Shown in the sheet in a compact panel for the record. |
| E | Tide | Two or three bands with a wavy edge, sometimes tilted, sometimes a small sun. | The calmest family; a list of them looks like a shelf of book spines; reads well at 16px. | Low distinctness between channels; first pass was monotonous, and the 90° "turned" variant looked like curtains and was removed. |
| F | Hills | A sky gradient, often a sun, hills in four arrangements (two hills, valley, one hill, ridge). | Charming, the most "picture"; four scenes give real variety; good at 16px. | Two tones of one hue can get close in dark; the sun is always a pale dot top-left-ish, so a list has a repeated beat. |

## Recommendation

1. **B Blocks** as the default. It is the only family where each mark is recognisable by shape, not only colour, which is what a sidebar of twenty rows needs. It is the cheapest to render, has no gradients, and the Bauhaus language sits well next to Phosphor and the seated-j logo without becoming clip-art. The chroma cap keeps it calm against Coral.
2. **F Hills** as the second style, and the one to offer as a user choice. It is the friendliest and the closest to "an image". If the owner wants one family only and prefers picture over mark, pick F.
3. **C Sunset** is a sound alternative to F with a single motif. Keep it if the picker offers three styles.
4. **A Bloom** keeps its place for group DMs (person-hue blobs) even if it is not a channel style.
5. **E Tide** can be dropped; it does little that F does not do better.

Whichever family ships, the semantic layer should ship with it. In the demo it moves #alerts-prod to coral and #eng to teal, and that small link between name and colour is what makes the marks feel assigned rather than random.

## How it would work in the app

**Where it lives.** A pure function in a small package (`@juno/channel-marks` or inside `@juno/ui` next to `ChannelIcon`): `(channel, style, theme, size, seed) → SVG string`. No React, no Effect, no tokens import; the palette is its own OKLCH table, converted to hex at call time. `ChannelIcon` renders the string with `dangerouslySetInnerHTML` inside the existing 40px tile and the 14px meta slot, replacing the icon-on-colour square. The picker (`ChannelIconPicker`) grows a "Generated" tab with the style choice and Shuffle.

**Seed, Shuffle and pinning.** The default seed is the channel id, so every client of the same workspace draws the same mark with no sync. Shuffle appends a counter (`${id}#${n}`) and stores `n` in the client-only channel overlay that already holds the chosen icon and colour. Pinning is the absence of a Shuffle: the overlay stores `{ style, seed }` once the user touches the mark, and nothing changes it afterwards. Reset clears the overlay row. The overlay is per workspace, in the durable user database, never written to Slack.

**Theme.** The generator takes the theme as an input and returns a different string; it does not use CSS variables. The renderer memoises on `${style}:${theme}:${size}:${seed}` and re-renders the list once when the theme switches, which already repaints every row. Accent changes do not touch the marks.

**Performance.** One mark is a few hundred bytes and takes about 10 µs to generate, so 900 rows (the real workspace count) cost under 10 ms once and are then served from the memo. Keep the strings in a `Map` keyed as above, bounded to a few thousand entries. Render inline SVG, not `<img>` with a data URL, so the clip and gradient ids stay in one document and the browser does not decode an image per row. Ids are prefixed with the hash so two marks never share a gradient. No filters: the brief allowed cheap grain, but every `feTurbulence` is a per-element raster pass and the list rules in `docs/performance.md` forbid that cost on 20 visible rows; if grain is ever wanted it should be one shared pattern in a single `<defs>` block at the root.

**Accessibility.** The mark is decorative. It renders with `aria-hidden="true"` and no title; the channel name beside it carries the meaning, and the row's accessible name is unchanged. Nothing in the mark encodes state, so no colour is meaning, and the halo and dot shapes were chosen to avoid reading as an unread badge or a presence dot.

**Spec edits when adopted.** SPEC §5 "each channel gets an icon and a colour" becomes "each channel gets a generated mark, with a style choice, Shuffle and reset"; tokens.md 1.6 drops the sentence that the person hue is the default channel tile colour; `friendly-layer.md` §1 keeps "no gradients" for chrome and notes that the marks are the one place a gradient appears (Hills) or does not (Blocks).
