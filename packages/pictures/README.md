# @juno/pictures

Home's pictures and their words (SPEC 12, "A picture" and "Pictures and the gallery"): the bundled catalog of paintings, prints, nature studies, space images and objects (sculpture, reliefs, vessels, masks), each with its line, about, link to read more, optional scale, sources and licence, and the rule that picks the next one. Data and pure functions; the image files live in the R2 bucket `juno-art` and, once downloaded, in the engine's picture cache (`packages/engine/src/pictures/`).

## Public API

- `.` (small, loads with Home): the `Picture`, `PictureLine`, `PictureLearnMore`, `PictureScale`, `PictureLabel` and `PictureKind` types, `pictureFile(id, size)` (`<id>-small.webp`, `<id>-large.webp`), `PICTURE_ID`, `PICTURE_KINDS`, `labelOf(picture)` (what Home's label and line need), `pictureYear(picture)` (the year the gallery's order by time uses: the picture's own `year`, negative before the common era, else `yearOf(date)`), `yearOf(date)` (the year a common-era date gives), `suitsNight`, `isLateNight(now)` and `pickPicture(list, seen, random, { night, avoid })`: the next picture, unseen first, late at night one that suits the night while one is left, and never the one showing twice in a row.
- `./catalog`: `PICTURES`, every picture with its words. Its own chunk: the renderer imports it only with `import()` (`@juno/state`'s `loadPictures`), when idle after Home paints and when the gallery opens.

## Adding a picture

1. Record the image's licence as its source page states it (`public-domain`, `cc0`, `cc-by-2.0`, `cc-by-3.0`, `cc-by-4.0`, `cc-by-sa-3.0`, `cc-by-sa-4.0`; add a value when a new one is needed). The licence does not rule a picture out in this personal app, but every picture keeps a `credit` line, shown on its page, naming the photographer and licence where there is one (ESA/Hubble and ESA/Webb images show the credit ESA asks for). A photograph of a replica says so in its title, place and credit.
2. Give the picture its `kind` (`objects` for sculpture, reliefs, vessels, seals and masks) and, for a date before the common era or in "years ago", a `year`, negative for BCE. Write a caption (one sentence, at most 160 characters; it is the image's alt text), a line (a verbatim quote with `by`, or one dated fact, at most about 140 characters, with its source and an optional `context` clause for the picture page), an about (two to four plain sentences), a `learnMore` link (the museum's object page or the release, labelled with the institution) and, where it says something, a `scale` (the museum's size in cm, or the distance in light-years or km). Plain English, no hype, no metaphors; leave it out when in doubt, and keep popular myths out (`docs/design/home-art/README.md`, "Writing the words").
3. Add the original's download URL to `scripts/pictures/sources.json`, run `pnpm pictures:build --only <id>` for its two files and its `ratio`, then `pnpm pictures:upload` (`scripts/pictures/README.md`).

## Links to check by hand

The ancient and early works added on 2026-10-22 had their links resolved from a script, not opened in a browser; the British Museum (`standard-of-ur-peace`, `yaxchilan-lintel-24`) and SLUB Dresden (`dresden-codex-page-74`) pages refused it, so a person should open those three once. Where no museum page could be confirmed the entry links Wikipedia. The links of the pictures before them were opened in Chrome on 2026-10-21. These ten did not load the object page from an automated browser (a bot check, a refused connection or a server error), so a person should open each once and fix any that do not show the right object:

- `monet-beach-at-sainte-adresse`, `caillebotte-paris-street-rainy-day`, `seurat-sunday-on-la-grande-jatte`, `monet-water-lilies-1906`: Art Institute of Chicago (bot check).
- `sorolla-fish-is-expensive`: Museo del Prado (bot check).
- `klimt-the-kiss`: Belvedere (no connection).
- `friedrich-wanderer-sea-of-fog`: Hamburger Kunsthalle (server error).
- `haeckel-diatomea`: Internet Archive (timed out in the browser; curl gets the page).
- `merian-guava-tarantulas`: links to the Getty's exhibition page, not an object page; the Biodiversity Heritage Library page for the plate is behind a bot check.
- `haeckel-discomedusae`: links to a Public Domain Review article; the Library of Congress item page (`loc.gov/item/2014645034/`) is behind a bot check.

## Tests

`pnpm --filter @juno/pictures test`: every entry has a licence, a credit, a source page, its shape, a year (its own, below 1 for a BCE or "years ago" date and in its date's century otherwise, or the one its date gives) and a caption within length; a sourced line within length, an about, and a link labelled with a name, not an address; scale numbers are positive and distances belong to space images. No entry is pinned.

## Must not

Import anything. The catalog stays data, so the start bundle never carries it.
