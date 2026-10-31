# Juno's site

The product site at https://juno.tushar.ai. Static HTML and CSS, no build step.

A Vercel project with this folder as its root deploys it on each push to main that touches `site/`.

## Files

- `index.html`, `styles.css`: the page.
- `fonts/`: Figtree (variable) and Instrument Serif, copied from the `@fontsource` packages the app bundles. Both are under the SIL Open Font License 1.1; the licence files sit beside them.
- `img/`: screenshots from `docs/readme/` (1440 wide, shown at 720 CSS pixels at most) and one still from the launch film. A replaced image gets a new filename, or caches keep the old one.
- `icon.svg`: the app icon from `assets/`.
- `trailer-poster.jpg`: the trailer's poster, shown before the video plays.

## Placeholders

The trailer is not finished. The page points at `/trailer.mp4`, which does not exist yet, and `trailer-poster.jpg` is a frame from a draft cut. When the final trailer lands, add `trailer.mp4` here and replace `trailer-poster.jpg` with a frame from it.

## Rules

- Claim only what the README claims; it was checked against the code.
- Copy follows the writing rules in tstack's writing skill: plain words, short sentences, no em dashes.
- No `cursor: pointer` except on real links.
- Every image is sharp at the size it is shown: a 1440-wide screenshot is never shown wider than 720 CSS pixels.
