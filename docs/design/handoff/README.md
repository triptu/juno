# Juno handoff

- `SPEC.md`: the product and design spec. Start here.
- `screenshots/`: the figures referenced in SPEC.md.
- `prototype/Threads v3.dc.html`: the interactive prototype. Open it in a browser to click through every flow. It loads `support.js`, `colors_and_type.css` and the fonts in `assets/` from this folder, and needs an internet connection for the icons.
- `prototype/colors_and_type.css`: the design tokens (colors, type, radii, shadows) to port into StyleX.

Notes for the build:
- The prototype's AI judgements (titles, summaries, routing, clarity, notification decisions, For you cards) are simulated. Real behaviour is described in SPEC.md section 15.
- Where the prototype and SPEC.md differ, SPEC.md wins. One example: the prototype uses `cursor: pointer`, but the app should not.
