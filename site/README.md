# Juno's site

The product site at https://juno.tushar.ai. Static HTML and CSS, no build step.

A Vercel project with this folder as its root deploys it on each push to main that touches `site/`.

## Files

- `index.html`, `styles.css`: the page.
- `fonts/`: Figtree (variable) and Instrument Serif, copied from the `@fontsource` packages the app bundles. Both are under the SIL Open Font License 1.1; the licence files sit beside them.
- `loops/`: one silent loop per point with a poster frame for each. Four are cut from the launch film and one is a recording of the app. See "Loops" below.
- `img/`: `home-picture.jpg`, Home's caught-up painting, rendered from the film project (see "Stills"). The older screenshots there are no longer used by the page. A replaced image gets a new filename, or caches keep the old one.
- `icon.svg`: the app icon from `assets/`.
- `trailer-poster.jpg`: the trailer's poster, shown before the video plays.
- `try/` (once published): the read-only demo at `/try/`, a copy of `bun run demo:build`'s output. Never edit it by hand; `docs/development.md`, "Demo", says how to publish it. `vercel.json` redirects `/try` to `/try/` and sets its cache times.

## Placeholders

The trailer is not finished. The page points at `/trailer.mp4`, which does not exist yet, and `trailer-poster.jpg` is a frame from a draft cut. When the final trailer lands, add `trailer.mp4` here and replace `trailer-poster.jpg` with a frame from it.

## Loops

Each film loop is a cut of the 4K master (3840 by 2160, 30 fps, 62 s), muted, with the bottom sixth cropped off and scaled to 1600 wide. That band holds the film's burned-in caption, which repeats the point's heading. A loop starts on a frame that shows the point (never an empty frame), and its poster is that first frame, so the page shows the same picture before and after the video starts.

| Loop | Film time |
|---|---|
| `topics.mp4` | 8.5 to 13.0 s |
| `notifications.mp4` | 21.0 to 27.0 s |
| `home.mp4` | 43.8 to 48.0 s |
| `agent.mp4` | 35.0 to 41.0 s |

To cut them, run this with `FILM` set to the master's path. Each loop should stay under 2 MB; raise the CRF a little if one does not.

```sh
cut() {
  ffmpeg -y -ss "$2" -to "$3" -i "$FILM" -an \
    -vf "crop=iw:ih*5/6:0:0,scale=1600:-2" -r 30 \
    -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -preset slow \
    -movflags +faststart "loops/$1.mp4"
  ffmpeg -y -ss "$2" -i "$FILM" -frames:v 1 \
    -vf "crop=iw:ih*5/6:0:0,scale=1600:-2" -q:v 3 "loops/$1-poster.jpg"
}
cut topics 8.5 13.0
cut notifications 21.0 27.0
cut home 43.8 48.0
cut agent 35.0 41.0
```

`speed.mp4` is not from the film. It is a recording of the app's renderer in the web shell (`bun run web --demo`, the invented company Kestrel) at a 1440 by 900 window at 2x, taken by a Playwright screencast whose frames are held for their real on-screen time, so it plays at real speed with no slow motion. The arrow cursor is drawn into the page, since headless Chrome draws none. Three topics are open in tabs and the pointer clicks each tab in turn. The recording is scaled to 1600 wide with the same encoder settings, with no crop, and its poster is its first frame. Retake it with the capture scripts in the launch work folder (`captures/index.md` there says how) and check every frame for names the demo seed has since changed.

The page plays each loop with `autoplay muted loop playsinline`. With reduced motion on, a short script removes `autoplay` and reloads each video, so the poster shows instead.

## Stills

`img/home-picture.jpg` is the last frame of the film's `BodyHome` composition, rendered at 2x from the film project (`remotion still build-final BodyHome --frame=179 --scale=2`), cropped of its caption band and scaled to 1600 wide, JPEG quality 2.

## Rules

- Claim only what the README claims; it was checked against the code. The speed point names mechanisms from `docs/performance.md`, `docs/architecture.md`, `apps/desktop/dom/instant-paths.test.ts` and `packages/engine/src/postQueue.ts`, and no number.
- Copy follows the writing rules in tstack's writing skill: plain words, short sentences, no em dashes.
- No `cursor: pointer` except on real links.
- Every image is sharp at the size it is shown: nothing is shown wider than 960 CSS pixels, and every loop and still is 1600 wide.
- Every loop's poster is a frame that shows the point, and the loop starts on it.
