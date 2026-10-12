# Juno logo, phase 1: exploration

Six concepts for the Juno mark and macOS app icon. Nothing here is wired into the app yet; `assets/icon.svg` is unchanged.

## What is in this folder

- `concepts/<name>/mark.svg`: flat mark, viewBox 0 0 64 64, ink (#1B180E) on transparent. For in-app use, the favicon and the menu bar. Every mark is a hand-written path with no font dependency, so it can be tinted with `currentColor` later.
- `concepts/<name>/app-icon.svg`: macOS app icon on a 1024×1024 canvas. The body is an 824×824 continuous-corner rounded square (radius 185, Apple-style corner smoothing) centred with a 100px margin, a subtle top-to-bottom paper gradient, a 1px hairline ring and a soft drop shadow inside the margin.
- `concepts/<name>/app-icon-dark.svg`: same icon with a near-black body and a paper mark, for dark desktops and the macOS dark icon slot.
- `comparison.html` and `comparison.png`: phase 1. Every concept at 16, 32, 64 and 128px on light and dark, the app icon at 220px, both Dock mock-ups, and the mark in a mock menu bar and tab.
- `comparison-2.html` and `comparison-2.png`: phase 1b, the seated j variations next to `thread` and `reply`, with a large row annotated with the three readings.
- `comparison-3.html` and `comparison-3.png`: phase 1c, bow refined and the laptop variants, with `bow` as the reference and four readings per mark.
- `concepts/<name>/mark-16.svg`: where present, a simplified mark for 16px and below. The sheets use it in the 16px cells.

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

## Phase 1c: bow, tablet and laptop

The owner chose `bow` from phase 1b and reads it as a person sitting and looking at a tablet lying on the table in front of them. The direction is now friendly and a little playful. Phase 1c refines `bow` and turns the dots into an open laptop.

All six share one figure: head forward of the spine (r7 at 40,10), a single cubic for the back that flattens into the table line at y 48.6, stroke 8.5 with round ends. The figure sits two units further right than `bow` so the device has room on the left.

What the renders taught, over three passes:

- Graduated dots that shrink as they rise read as a motion trail or sparkles, not a screen. Screen dots have to be equal in size and on a straight line.
- If the tablet dots touch the hook end they read as a dotted continuation of the j. They need a clear gap.
- Horizontal bars for messages read as dashes or a menu, not chat bubbles.
- Three or more small dots blur into a smudge at 16px, so the dotted-screen marks need a simplified 16px version.

### bow-2

`bow` refined: slightly larger head, cleaner back curve, tablet dots a little smaller than the stroke and clear of the hook.

- Strengths: the owner's reading, kept. Calm and friendly. Reads as a j at 16px.
- Weaknesses: at 16px the two dots still fuse into a short dash, so it can read as "...j".

### laptop-rise

Base dot on the table, two equal dots rising steeply: a screen tilted open.

- Strengths: a real open laptop at 64px and above, and a thread climbing.
- Weaknesses: the three dots smudge at 16px with no fallback drawn yet. Still a little "sparkle".

### laptop-two

Base dot on the table line, one dot for the top of the screen.

- Strengths: reads at every size with one drawing: a j, a person at a laptop, a message with two replies. The lightest and calmest of the laptop marks, and the only one that needs no 16px variant. Friendly without being a pictogram.
- Weaknesses: the laptop reading is the most suggestive of the set; some people will see a person and a ball.

### laptop-edge

Base dot and a dotted screen edge leaning back.

- Strengths: the most relaxed angle.
- Weaknesses: the dots read as a scattered trail; the laptop reading is weaker than rise and the 16px smudge is the same.

### laptop-line

The flat hook extends into a keyboard; the screen is a dotted line rising from its end. Uses `mark-16.svg` (the laptop-two drawing) at 16px.

- Strengths: the clearest laptop at 64px and above: a flat keyboard with a screen open behind it. The strongest "typing, calmly" picture.
- Weaknesses: the longer foot weakens the j (towards an L) and the three small dots need the 16px fallback, so it is two drawings, not one.

### laptop-chat

Base dot with two staggered message bubbles on the screen. Uses `mark-16.svg` at 16px.

- Strengths: says "messages" literally.
- Weaknesses: the bubbles read as dashes or a menu; it is the busiest mark and the least clean. Needs the fallback at 16px.

### Ranking for phase 1c

1. **laptop-two.** One drawing that holds at 16px, in the Dock and at 1024, friendly, still a j.
2. **laptop-line.** Best laptop reading at large sizes; pairs with laptop-two as its small version.
3. **bow-2.** The tablet reading the owner liked, refined. Ellipsis risk at 16px.
4. **laptop-rise.** Good at 64px, smudges at 16px.
5. **laptop-edge.** Reads as a trail.
6. **laptop-chat.** Dashes, not bubbles.

### Recommendation

Adopt **laptop-two** as the mark. If the owner wants a stronger laptop at large sizes, use **laptop-line** for the 1024 and 512 icon slots and laptop-two for everything at 64px and below; the figure, head and table line are identical, so they read as one mark. Keep **bow-2** on file as the tablet alternative.

## Suggested phase 2 for the chosen mark

- Redraw the hook as a single filled outline rather than a stroke so terminals can be tuned (slightly flared end, optically heavier dot).
- For stretch: tune the gap between the hook end and the feet dot so it survives 16px on `--background-subtle`; test the dot one size smaller than the head.
- For laptop-two: test the screen dot one size smaller and a little closer to the base, and check the mark on `--background-subtle` and in the dark menu bar as a template image.
- Check against the Apple icon template at 1024 and 16 with the real shadow and squircle mask.
- Try one two-colour variant (dot in midnight blue) and decide whether it stays ink-only.
- Decide the in-app sizes: 16px menu bar template, 14px tab, 24px sidebar.
