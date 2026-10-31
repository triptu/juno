# Juno's site

The product site at https://juno.tushar.ai. Static HTML, CSS and a little script, with no build step.

A Vercel project with this folder as its root deploys it on each push to main that touches `site/`.

## Files

- `index.html`, `styles.css`: the page. Without script it is complete and still.
- `script.js`: keeps the appearance choice, starts the film and the speed clip, and settles the notification toast into place.
- `field.js`: draws the coloured field behind the hero, the notifications section and the footer, with WebGL.
- `scene.js`: moves the footer's drawings and the seated j with the pointer.
- `features.js`: lights up part of the window, or opens a crop over it, when you point at a feature label.
- `fonts/`: Figtree (variable) and Instrument Serif, copied from the `@fontsource` packages the app bundles. Both are under the SIL Open Font License 1.1; the licence files sit beside them.
- `img/`: every picture, as 2x webp with a light and a dark file. `window-*` is the whole window the features section labels, and `inset-*` are the crops it opens for things the window does not show. They are cut from Remotion stills of Juno's real views with the film's sample data.
- `video/`: the speed clip, light and dark, as mp4 and webm, with a poster for each.
- `icon.svg`: the app icon from `assets/`.
- `trailer.mp4`, `trailer-poster.jpg`: the launch film (1:45, 1080p H.264) and its poster. The 4K master and the Remotion project that draws it are in the launch work folder, `film/` (`out/final2/`).
- `try/`: the read-only demo at `/try/`, a copy of `bun run demo:build`'s output. Never edit it by hand; `docs/development.md`, "Demo", says how to publish it.
- `vercel.json`: redirects `/try` to `/try/` and sets cache times. Fonts, pictures and the demo's hashed assets are cached for a year, so a replaced picture needs a new filename. The speed clip is cached for a day.

## Appearance

The nav's one button flips light and dark. A choice that matches the system's is not stored, so the page follows the system again. The choice is kept in `localStorage` (`juno-theme`) and applied by a script in `<head>` before the first paint. Each picture has a light and a dark file and CSS shows one, so the other theme's picture is never fetched.

## The speed clip

A real-time recording of the app on the film's sample company, Aven Studio: 6.8 s, 54 actions, 60 fps, 2560 by 1440. The only overlay is a stopwatch. The files, their timings and the scripts that recorded them are in the launch work folder, `speed-clip/v3` (`notes.md` there).

It plays muted and looped in the page's appearance. With reduced motion on it shows its poster and a Play button; with motion allowed the Play button is hidden.

## Motion

The fields and the footer scene run only while on screen, in a visible tab, with motion allowed. Under reduced motion the page is still and the feature crops appear without a transition.

## Rules

- Claim only what the code does. Each feature label was checked against the code on main when it was written; check a new one the same way.
- Copy follows the writing rules in tstack's writing skill: plain words, short sentences, no em dashes.
- No `cursor: pointer` except on real links.
- Every picture is sharp at the size it is shown.
