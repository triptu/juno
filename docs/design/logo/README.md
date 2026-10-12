# Juno logo, phase 1: exploration

Six concepts for the Juno mark and macOS app icon. Nothing here is wired into the app yet; `assets/icon.svg` is unchanged.

## What is in this folder

- `concepts/<name>/mark.svg`: flat mark, viewBox 0 0 64 64, ink (#1B180E) on transparent. For in-app use, the favicon and the menu bar. Every mark is a hand-written path with no font dependency, so it can be tinted with `currentColor` later.
- `concepts/<name>/app-icon.svg`: macOS app icon on a 1024×1024 canvas. The body is an 824×824 continuous-corner rounded square (radius 185, Apple-style corner smoothing) centred with a 100px margin, a subtle top-to-bottom paper gradient, a 1px hairline ring and a soft drop shadow inside the margin.
- `concepts/<name>/app-icon-dark.svg`: same icon with a near-black body and a paper mark, for dark desktops and the macOS dark icon slot.
- `comparison.html` and `comparison.png`: phase 1. Every concept at 16, 32, 64 and 128px on light and dark, the app icon at 220px, both Dock mock-ups, and the mark in a mock menu bar and tab.
- `comparison-2.html` and `comparison-2.png`: phase 1b, the seated j variations next to `thread` and `reply`, with a large row annotated with the three readings.

To re-render the sheet, serve this folder over HTTP (for example `python3 -m http.server 8765` from this directory) and screenshot `comparison.html` at 1560px wide. Chromium blocks `file:` URLs for the SVG images.

## Concepts

### thread

A lowercase j drawn as a thread: the dot is the first message, the hook is the reply line that follows it. One silhouette carries both the name and the product.

- Strengths: ties the name to the idea of a thread. Reads clearly at 16px, including the gap between dot and stem. Round and quiet, sits well next to system icons. Works as one colour.
- Weaknesses: close to a lowercase j from a geometric sans, so it needs a careful final drawing to feel owned rather than typed. The dot could take an accent colour, but that would break "calm by default".

### reply

A message and its reply: a root dot, a line that drops and turns right, and the reply's own dot. It is the reply glyph (↳) made into a mark.

- Strengths: the most "topics, not channels" idea in the set. Distinctive; nothing in the Dock looks like it. Calm, two dots and one stroke.
- Weaknesses: no link to the name. Could be mistaken for an indent or reply button in chrome if the same shape is used as an in-app icon. Weight sits bottom-right, so it needs optical centring in the tile.

### monogram

A heavy geometric J with a short top bar, drawn as two strokes with flat ends. A nod to the serif page titles without using a font.

- Strengths: unmistakable at every size. Safe, solid, easy to reproduce.
- Weaknesses: a letter in a tile is what most apps do, so it is the least distinctive option. Says nothing about topics or calm.

### crescent

Juno as a moon: a single thick crescent cut from two circles.

- Strengths: the calmest shape here. Very crisp at 16px. One path.
- Weaknesses: collides with the macOS Focus and dark-mode crescents, so in the menu bar it reads as a system control. No link to conversations.

### rows

Three topic rows, the lower ones fading: the sidebar list, with quiet things disappearing.

- Strengths: a direct picture of the product's main surface and of principle 3.
- Weaknesses: looks like a text-alignment icon. The fade needs opacity, so it is not a true one-colour mark and loses its meaning when tinted. Weakest at 16px.

### bubble

A speech form with two rows cut out of it: conversations, organized.

- Strengths: instantly says "messaging". The cut-out rows survive 16px.
- Weaknesses: interchangeable with Messages, Slack and every chat app. Generic in exactly the way Juno is not.

## Recommendation

1. **thread.** The only concept that carries both the name and the product in one calm silhouette. Take this to phase 2.
2. **reply.** The strongest expression of topic-first. Keep it as the alternative if thread ends up reading as "just a j", or consider it for the in-app empty-thread illustration.
3. **monogram.** The safe fallback; good but forgettable.
4. **crescent.** Beautiful but fights the system's own crescents in the menu bar.
5. **rows.** Too close to a text-align icon and not a one-colour mark.
6. **bubble.** Too generic for this product.

## Phase 1b: the seated j

Brief: one mark that reads at the same time as a J, a person sitting calmly, and a thread with replies. The dot is the head and the first message, the stroke is the spine and the thread line, the hook is the lap or legs, and any further dots are replies.

What the renders taught, over three passes:

- Two dots above a curved stroke read as a face. The first pass put reply dots at knee height, and every one of them turned into eyes and a smile. Reply dots have to sit on the lap line or beyond the feet, never above the hook.
- A dot inside the bowl fills in at 16px.
- Dots that shrink as they trail off read as an ellipsis or a typing indicator.
- A separate base stroke under the j reads as an underline, not a cushion.

### rest

Upright, the hook flattens into an open lap, no reply dot.

- Strengths: the calmest j in the set; crisp at every size.
- Weaknesses: the person reading is faint. It is a softer `thread`, not a new idea.

### seat

Upright, the hook closes into a flat base in one stroke, no reply dot.

- Strengths: the clearest seated figure with the fewest parts: head, back, legs folded out. Still a j at 16px. Nothing cute about it.
- Weaknesses: the flat hook weakens the J reading at 128px and above, where it drifts towards a mirrored L.

### lean

Leaning back, heavier stroke, knees up, no reply dot.

- Strengths: the only one with a posture that says "unhurried". Head behind the hips, weight on the hands. Reads as a j at 16px.
- Weaknesses: the big head and tilt make it the least neutral; it leans towards a playful italic. Thread reading is the plain "dot, then line".

### stretch

Upright, the hook turns flat, one reply dot at the feet.

- Strengths: all three readings hold on their own: a j with a stop, a figure with legs out and feet, a message and its reply. The dot sits on the lap line so there is no face. Crisp at 16px; the feet dot stays separate.
- Weaknesses: at 16px the feet dot is close to the hook end and could merge on a low-contrast background. Slightly wide; needs optical centring in the tile.

### cushion

Upright j with knees up, sitting on a faint base.

- Strengths: a true "sitting" reading, and a hint of the floor without a third dot.
- Weaknesses: the base is a second element with its own opacity, so the mark is no longer one colour and the base vanishes at 16px. Reads as an underlined j.

### bow

Head forward, spine curves into a flat lap, two equal reply dots trail from the feet.

- Strengths: meditative posture is real; two replies show "a thread", not just "a reply".
- Weaknesses: three dots in a row read as an ellipsis; the mark gets wide and busy. Too much for a 16px icon.

### Ranking for phase 1b

1. **stretch.** The only one where J, person and thread each hold on their own and the figure is calm rather than cute.
2. **seat.** Simplest seated figure; pick this if the reply dot proves to be noise.
3. **lean.** Best posture, least neutral.
4. **rest.** Calm but says little more than `thread`.
5. **cushion.** Second element and opacity work against it.
6. **bow.** Too busy for a mark.

### Recommendation

Take **stretch** into phase 2, with **seat** as the fallback. Compared with phase 1, stretch keeps what made `thread` strong (the name, the thread line) and borrows the one thing `reply` did better (a visible reply). The seated reading is a quiet second layer, not the headline.

## Suggested phase 2 for thread or stretch

- Redraw the hook as a single filled outline rather than a stroke so terminals can be tuned (slightly flared end, optically heavier dot).
- For stretch: tune the gap between the hook end and the feet dot so it survives 16px on `--background-subtle`; test the dot one size smaller than the head.
- Check against the Apple icon template at 1024 and 16 with the real shadow and squircle mask.
- Try one two-colour variant (dot in midnight blue) and decide whether it stays ink-only.
- Decide the in-app sizes: 16px menu bar template, 14px tab, 24px sidebar.
