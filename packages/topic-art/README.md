# @juno/topic-art

Topic art as a vocabulary. The model does not send a picture; it sends a short recipe in a tiny SVG dialect on a 40 by 40 grid, with colours named by role. This package parses that recipe against a whitelist, rebuilds the SVG from the checked recipe, and draws the Tide pebble a topic shows until it has art. Pure functions, no dependencies, no React and no Effect. The design study is `docs/design/topic-art/v2/` (`vocabulary.md` is the plain-English version of the rules).

## Public API

- `parseRecipe(text)`: the model's reply to `{ ok: true, recipe }` or `{ ok: false, reason }`. One `<svg>` is found in the text (prose and fences around it are ignored); the root must name `data-hue` from the eight hues and may carry `data-confident="false"`. Every tag must be one of `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, `g` (nested at most two deep); every attribute must be in that tag's list and match its grammar (numbers within ±60, path data and points from the path grammar, `transform` only `rotate`, `translate` and `scale`, `fill` and `stroke` only `ink`, `soft`, `accent`, `accent2`, `none`, `stroke-width` 1 to 5, `detail="1"`). Text between tags, an unknown tag, an unknown attribute or an unmatched value fails the whole drawing with a one-line reason the retry prompt quotes. At most 40 shapes.
- `serialiseRecipe(recipe)`: the canonical text, which is what the store keeps (200 to 900 bytes). `parseRecipe(serialiseRecipe(r))` gives `r` back.
- `renderArt(recipe, size, hue?)`: inline SVG for 40 (rows), 20 (peek) or 16 (tabs). `hue` paints the drawing in another hue than the recipe's `data-hue`; the app passes `pebbleHue(topicId)`. Colours are CSS variables, `var(--art-<hue>-<role>)`, declared in `@juno/tokens` with light and dark values, so one string serves both themes. The shared line is ink at 2.75 units with round caps and joins. Below 20px, elements marked `detail="1"` are dropped and the stroke goes 30% heavier.
- `renderPebble(topicId, size)`: the placeholder, seeded by the topic id alone, so every client draws the same pebble. Wave bands in `var(--tide-<hue>-<tone>)` clipped to a free-form closed curve about 30px across. Ported from `docs/design/channel-marks/generator.js` and `docs/design/topic-art/v2/tide.mjs`.
- `pebbleHue(topicId)`: the hue a topic is drawn in, the pebble's main hue. The art takes it too, so a list spreads over all eight hues and the art keeps the colour of the pebble it replaces (`docs/design/topic-art/v3`). The recipe's own hue is still parsed and stored; Redraw quotes it.
- `HUE_NAMES`, `ROLES`, `TIDE_TONES`, `artVar`, `tideVar`, `hashId`: the names the renderer writes and the hash it seeds with.

## What it decides

- There is no sanitiser in the HTML sense and there must not be one. A sanitiser that strips bad tags from model markup is a blacklist someone has to keep complete. This is the opposite: a whitelist parse into a typed recipe, and markup rebuilt from that recipe by code that writes fixed names and inserts only values a grammar matched. Nothing the grammar did not match can reach the DOM.
- The same check runs wherever the recipe is read: `@juno/ai` validates the model's reply with it, and `@juno/ui` parses the stored text again before drawing. A tampered store row is a placeholder, not a hole.
- Clip ids come from the topic id, so two pebbles of one topic on the same page share one identical definition and two topics never collide.

## Must not

- Import anything. It is the one piece the AI package, the engine and the UI all read, so it stays below them all.
- Write a colour value. Values live in `@juno/tokens`; this package writes the variable names.

## Testing

`pnpm --filter @juno/topic-art test`. Behaviour through `parseRecipe`, `serialiseRecipe`, `renderArt` and `renderPebble`: a valid drawing, the round trip, every kind of hostile reply (scripts, text, `href`, event handlers, style, hex and `url()` colours, path data outside the grammar, off-grid numbers, deep groups), the detail and stroke rules below 20px, and that rendered markup names only whitelisted tags and attributes.
