# @juno/pictures

Home's pictures (SPEC 12, "A picture" and "Pictures and the gallery"): the bundled catalog of paintings, prints, nature studies and space images, each with its story, sources and licence, and the rule that picks the next one. Data and pure functions; the image files live in the R2 bucket `juno-art` and, once downloaded, in the engine's picture cache (`packages/engine/src/pictures/`).

## Public API

- `.` (small, loads with Home): the `Picture`, `PictureFact`, `PictureLabel` and `PictureKind` types, `pictureFile(id, size)` (`<id>-small.webp`, `<id>-large.webp`), `PICTURE_ID`, `PICTURE_KINDS`, `labelOf(picture)` (what Home's plaque needs), `suitsNight`, `isLateNight(now)` and `pickPicture(list, seen, random, { night, avoid })`: the next picture, unseen first, late at night one that suits the night while one is left, and never the one showing twice in a row.
- `./catalog`: `PICTURES`, every picture with its story. Its own chunk: the renderer imports it only with `import()` (`@juno/state`'s `loadPictures`), when idle after Home paints and when the gallery opens.

## Adding a picture

1. Artworks must be public domain or CC0 (Met, Art Institute of Chicago, Rijksmuseum, National Gallery of Art, Cleveland, Smithsonian, or Wikimedia Commons with the PD tag read on the file page). NASA images are public domain; ESA/Hubble and ESA/Webb images are CC BY 4.0 and show the credit ESA asks for.
2. Write a caption (one sentence, at most 160 characters) and three to five facts, each at most 320 characters, each with the source that states it. Plain English, no hype, no metaphors; leave a fact out when in doubt, and keep popular myths out.
3. Add the original's download URL to `scripts/pictures/sources.json`, run `node scripts/pictures/build.mjs --only <id>` for its two files and its `ratio`, then `node scripts/pictures/upload.mjs` (`scripts/pictures/README.md`).

## Tests

`pnpm --filter @juno/pictures test`: every entry has a licence, a credit, a source page, its shape, a caption within length and three to five sourced facts. No entry is pinned.

## Must not

Import anything. The catalog stays data, so the start bundle never carries it.
