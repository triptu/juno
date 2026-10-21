# @juno/pictures

Home's pictures and their words (SPEC 12, "A picture" and "Pictures and the gallery"): the bundled catalog of paintings, prints, nature studies and space images, each with its line, about, link to read more, optional scale, sources and licence, and the rule that picks the next one. Data and pure functions; the image files live in the R2 bucket `juno-art` and, once downloaded, in the engine's picture cache (`packages/engine/src/pictures/`).

## Public API

- `.` (small, loads with Home): the `Picture`, `PictureLine`, `PictureLearnMore`, `PictureScale`, `PictureLabel` and `PictureKind` types, `pictureFile(id, size)` (`<id>-small.webp`, `<id>-large.webp`), `PICTURE_ID`, `PICTURE_KINDS`, `labelOf(picture)` (what Home's label and line need), `yearOf(date)` (the year the gallery's order by time uses), `suitsNight`, `isLateNight(now)` and `pickPicture(list, seen, random, { night, avoid })`: the next picture, unseen first, late at night one that suits the night while one is left, and never the one showing twice in a row.
- `./catalog`: `PICTURES`, every picture with its words. Its own chunk: the renderer imports it only with `import()` (`@juno/state`'s `loadPictures`), when idle after Home paints and when the gallery opens.

## Adding a picture

1. Artworks must be public domain or CC0 (Met, Art Institute of Chicago, Rijksmuseum, National Gallery of Art, Cleveland, Smithsonian, or Wikimedia Commons with the PD tag read on the file page). NASA images are public domain; ESA/Hubble and ESA/Webb images are CC BY 4.0 and show the credit ESA asks for.
2. Write a caption (one sentence, at most 160 characters; it is the image's alt text), a line (a verbatim quote with `by`, or one dated fact, at most about 140 characters, with its source and an optional `context` clause for the picture page), an about (two to four plain sentences), a `learnMore` link (the museum's object page or the release, labelled with the institution) and, where it says something, a `scale` (the museum's size in cm, or the distance in light-years or km). Plain English, no hype, no metaphors; leave it out when in doubt, and keep popular myths out (`docs/design/home-art/README.md`, "Writing the words").
3. Add the original's download URL to `scripts/pictures/sources.json`, run `pnpm pictures:build --only <id>` for its two files and its `ratio`, then `pnpm pictures:upload` (`scripts/pictures/README.md`).

## Tests

`pnpm --filter @juno/pictures test`: every entry has a licence, a credit, a source page, its shape, a year its date gives and a caption within length; a sourced line within length, an about, and a link labelled with a name, not an address; scale numbers are positive and distances belong to space images. No entry is pinned.

## Must not

Import anything. The catalog stays data, so the start bundle never carries it.
