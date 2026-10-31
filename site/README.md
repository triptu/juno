# Juno's site

The product site at https://juno.tushar.ai. Static HTML and CSS, no build step.

A Vercel project with this folder as its root deploys it on each push to main that touches `site/`.

## Files

- `index.html`, `styles.css`: the page.
- `fonts/`: Figtree (variable) and Instrument Serif, copied from the `@fontsource` packages the app bundles. Both are under the SIL Open Font License 1.1; the licence files sit beside them.
- `loops/`: one silent loop per point, cut from the launch film, with a poster frame for each. See "Loops" below.
- `img/`: the Search still from `docs/readme/` (1440 wide, shown at 960 CSS pixels at most). A replaced image gets a new filename, or caches keep the old one.
- `icon.svg`: the app icon from `assets/`.
- `trailer-poster.jpg`: the trailer's poster, shown before the video plays.

## Placeholders

The trailer is not finished. The page points at `/trailer.mp4`, which does not exist yet, and `trailer-poster.jpg` is a frame from a draft cut. When the final trailer lands, add `trailer.mp4` here and replace `trailer-poster.jpg` with a frame from it.

The loops in `loops/` are cut from the half-size draft of the film (960 by 540), so they are 960 wide. When the 4K master is rendered, cut them again at 1600 wide with the commands below.

## Loops

Each loop is a 6 second cut of the film, muted, with the bottom sixth cropped off. That band holds the film's burned-in caption, which repeats the point's heading. The film is 62 seconds at 30 fps.

| Loop | Film time |
|---|---|
| `topics.mp4` | 8.0 to 14.0 s |
| `notifications.mp4` | 18.5 to 24.5 s |
| `home.mp4` | 42.0 to 48.0 s |
| `agent.mp4` | 34.0 to 40.0 s |

The Search point uses a still (`img/search.png`) because the film holds on one search frame for about a second before it cuts to the next beat.

To cut them from the 4K master (3840 by 2160), run this with `FILM` set to the master's path. Each loop should stay under 2 MB; raise the CRF a little if one does not.

```sh
cut() {
  ffmpeg -y -ss "$2" -to "$3" -i "$FILM" -an \
    -vf "crop=iw:ih*5/6:0:0,scale=1600:-2" -r 30 \
    -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -preset slow \
    -movflags +faststart "loops/$1.mp4"
  ffmpeg -y -ss "$2" -i "$FILM" -frames:v 1 \
    -vf "crop=iw:ih*5/6:0:0,scale=1600:-2" -q:v 3 "loops/$1-poster.jpg"
}
cut topics 8.0 14.0
cut notifications 18.5 24.5
cut home 42.0 48.0
cut agent 34.0 40.0
```

The current files were made from `film-v3b-half.mp4` with the same commands minus the `scale` step.

The page plays each loop with `autoplay muted loop playsinline`. With reduced motion on, a short script removes `autoplay` and reloads each video, so the poster shows instead.

## Rules

- Claim only what the README claims; it was checked against the code.
- Copy follows the writing rules in tstack's writing skill: plain words, short sentences, no em dashes.
- No `cursor: pointer` except on real links.
- Every image is sharp at the size it is shown: a 1440-wide screenshot is never shown wider than 960 CSS pixels, and the final loops are 1600 wide.
