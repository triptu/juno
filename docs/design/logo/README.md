# Juno logo, phase 1: exploration

Six concepts for the Juno mark and macOS app icon. Nothing here is wired into the app yet; `assets/icon.svg` is unchanged.

## What is in this folder

- `concepts/<name>/mark.svg`: flat mark, viewBox 0 0 64 64, ink (#1B180E) on transparent. For in-app use, the favicon and the menu bar. Every mark is a hand-written path with no font dependency, so it can be tinted with `currentColor` later.
- `concepts/<name>/app-icon.svg`: macOS app icon on a 1024×1024 canvas. The body is an 824×824 continuous-corner rounded square (radius 185, Apple-style corner smoothing) centred with a 100px margin, a subtle top-to-bottom paper gradient, a 1px hairline ring and a soft drop shadow inside the margin.
- `concepts/<name>/app-icon-dark.svg`: same icon with a near-black body and a paper mark, for dark desktops and the macOS dark icon slot.
- `comparison.html` and `comparison.png`: every concept at 16, 32, 64 and 128px on light and dark, the app icon at 220px, both Dock mock-ups, and the mark in a mock menu bar and tab.

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

## Suggested phase 2 for thread

- Redraw the hook as a single filled outline rather than a stroke so terminals can be tuned (slightly flared end, optically heavier dot).
- Check against the Apple icon template at 1024 and 16 with the real shadow and squircle mask.
- Try one two-colour variant (dot in midnight blue) and decide whether it stays ink-only.
- Decide the in-app sizes: 16px menu bar template, 14px tab, 24px sidebar.
