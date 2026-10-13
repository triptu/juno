# The topic art vocabulary

What the model is allowed to draw, in plain words. The code is `vocab.mjs` (parser, validator, renderer) and `palette.mjs` (the colours). `README.md` has the comparison and the recommendation.

## The idea in one paragraph

The model does not send us a picture. It sends a short recipe in a tiny SVG dialect: a handful of shapes on a 40 by 40 grid, with colours named by role ("ink", "soft", "accent") instead of values. We parse that recipe into a typed list, check every tag, attribute and number against a whitelist, and then draw the icon ourselves from the checked list. The model's bytes never reach the page. Because colours are roles, the same recipe draws correctly in light and dark, and we can retune the whole palette without regenerating anything.

## Canvas

- A 40 by 40 grid. The drawing should stay inside 6 to 34 so there is margin. Numbers outside -60 to 60 are rejected (that is the only hard limit; a shape may bleed a little for a rounded end).
- The icon is shown at 40px in the sidebar row and the topic header (20px there), and at 16px in tabs and the meta line. Below 20px the renderer drops every element marked `detail="1"` and makes the stroke 30% heavier so a line stays at least 1.4px.
- Nothing is painted behind the drawing by default. The drawing sits on the row background, so it has to hold its own shape: a closed outline, or one soft-filled area. (The renderer can paint a subtle box or round 1's tile behind the same recipe; the recipe does not know or care. Inside a container the drawing is scaled to 80% so it clears the edge, and below 20px the container is dropped.)

## Elements

Seven shapes: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`. The relaxed and art-directed levels add `g`, a group that carries one transform or one opacity for the shapes inside it.

Nothing else. No `text` (no letters ever), no `defs`, `use`, `image`, `style`, `script`, `foreignObject`, no gradients, no filters, no `href` of any kind. An unknown tag fails the whole drawing.

## Attributes

- Geometry: the shape's own numbers (`cx cy r`, `x y width height rx ry`, `x1 y1 x2 y2`, `points`, `d`). Path data may contain only the path letters, digits, dots, commas, spaces and minus signs.
- `fill` and `stroke`: a role token only. Never a hex value, never a named colour, never `url(...)`.
- `stroke-width`: a number inside the level's range.
- `opacity`, `fill-opacity`, `stroke-opacity`: 0 to 1, clamped.
- `transform`: only `rotate(...)`, `translate(...)` and `scale(...)`, with plain numbers.
- `stroke-dasharray`: numbers only, relaxed and art-directed levels.
- `stroke-linecap` (`round` or `butt`) and `stroke-linejoin` (`round`, `bevel`, `miter`).
- `detail="1"`: a hint that this element may be dropped at 16px.

Any other attribute fails the drawing.

## Stroke

Every line is drawn with the ink role, width 2.75 on the 40 grid, round caps and round joins. The model gets this for free and does not set it. It may override the width per element inside the level's range. The default is set once in the renderer, so the whole set shares one line weight; that shared weight is most of what makes a list of icons look like one hand.

## Colour roles (the palette tokens)

The model names a hue once on the root (`data-hue`), one of coral, amber, olive, sage, teal, sky, periwinkle, plum. Inside the drawing it uses roles:

| Role | What it is | Light | Dark |
| --- | --- | --- | --- |
| `ink` | the line and any dark fill | a warm near-neutral with a trace of the hue, L 0.43 | a pale warm neutral with a trace of the hue, L 0.78 |
| `soft` | one quiet flat area that gives the object mass | the hue at L 0.885, chroma 0.038 | the hue at L 0.36, chroma 0.032 |
| `accent` | one small highlight where the eye lands | the hue at L 0.60, chroma 0.10 | the hue at L 0.72, chroma 0.085 |
| `accent2` | a second, quieter highlight (relaxed and art-directed only) | L 0.76, chroma 0.06 | L 0.56, chroma 0.05 |
| `none` | no paint | | |

Light and dark are tuned separately; only the hue angle is shared. Chroma is low everywhere except the accent, so a list of twenty icons reads as one grey-brown line family with small points of colour. The exact numbers are the `RAMP` table in `palette.mjs` and the swatches are the first section of the sheet (`palette.png`), with contrast against the sidebar: ink is 7.6:1 or better in light and 9.1:1 or better in dark; the accent is 3.6 to 3.9:1 in light and 7.2 to 7.7:1 in dark, enough for a highlight that is never the only carrier of meaning.

Round 1 had a `tile` role for knock-outs. It is gone: with no container there is nothing to knock out to, and the row background changes on hover and selection.

## The three freedom levels

The same parser, three rule sets. Everything above applies to all three; the table is what differs.

| | a · strict | b · relaxed | c · art-directed |
| --- | --- | --- | --- |
| Elements | at most 12 | at most 20 | at most 40 |
| Groups (`g`) | no | one level | two levels |
| Colour tokens | ink, soft, accent, none | plus accent2 | plus accent2 |
| Accent elements | exactly one | at most two | any |
| Stroke width | 2 to 4 | 1.5 to 4 | 1 to 5 |
| Dashes | no | yes | yes |
| What the prompt says | the rules, "draw exactly one object", three worked examples | the rules, "one object with real presence", two worked examples | a style guide in prose, no examples, the format section only |
| What the validator enforces | all of the rules | all of the rules | safety (tags, attributes, numbers), the tokens, and the size |

Strict is round 1's vocabulary with the new tokens and no container. Relaxed gives the model more ways to add mass and texture (layers, a second accent, thin inner lines, dashes) while keeping it inside a composition rule. Art-directed drops the composition rules from the checker and puts them in the brief instead, so the model is trusted to compose and only stopped from doing anything unsafe or off-palette.

## The validator, step by step

1. Find one `<svg>...</svg>` in the reply. Anything else in the reply (markdown fences, a sentence) is ignored; a reply with no `<svg>` fails.
2. Read `data-hue` from the root. It must be one of the eight names.
3. Walk the tags in order. Each tag must be in the level's list. Each attribute must be in that tag's list. Each value must match its grammar (numbers, path data, token names, transform forms). Count elements and accent uses against the level's limits. Groups must close and must not nest deeper than the level allows.
4. Any text between tags fails the drawing (this is where `<text>` content or a stray explanation would hide).
5. Clamp opacities to 0..1. Check stroke widths against the level's range.
6. Build the typed spec `{ hue, elements }`. From here on the model's text is discarded; `serialise(spec)` gives the canonical recipe, which is what is stored.

The whole check is about 100 lines and has no dependencies. A failure carries a one-line reason ("element `<text>` is not allowed", "more than 12 elements", "`fill` must be one of ink, soft, accent, none; got `#ff0000`").

## What happens on failure

- The reply is sent back once with the reason quoted ("That did not validate: more than 12 elements. Reply again..."). One retry, inside the same timeout.
- If the retry also fails, the topic keeps its placeholder (the Tide mark, see `README.md`). Nothing is shown to the user about the failure. The topic is tried again on the next title drift, not on a timer.
- A transport failure (timeout, 5xx) is not a model failure: it is retried on the next sync pass like any other background job.

## Sanitising

There is no sanitiser in the HTML sense, and there should not be one. A sanitiser that strips bad tags from model markup is a blacklist that someone has to keep complete. The validator is the opposite: a whitelist, and the output is rebuilt from the typed spec by our own renderer. The renderer writes fixed attribute names, inserts the role's colour value for the theme, and never copies a string it has not matched against a grammar. The stored row is the canonical spec, about 200 to 600 bytes; the SVG string is derived at render time and memoised.
