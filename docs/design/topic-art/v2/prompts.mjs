// The three briefs. Every level sees the same topic block and the same
// one-paragraph style; what differs is how much of the drawing the model
// may decide.
import { HUE_NAMES } from './palette.mjs'

export function topicBlock(t) {
  if (t.kind === 'main') {
    return [
      `Kind: a channel's Main (the stream of messages outside threads)`,
      `Channel: ${t.title}`,
      t.purpose ? `Purpose: ${t.purpose}` : null,
      t.topic ? `Topic: ${t.topic}` : null,
      `Recent messages:`,
      ...t.recent.map((m) => `- ${m}`),
    ].filter(Boolean).join('\n')
  }
  return [
    `Kind: a thread`,
    `Title: ${t.title}`,
    `Channel: ${t.channel}`,
    `First message: ${t.first}`,
    `Latest message: ${t.last}`,
  ].join('\n')
}

const STYLE = `Juno is a calm, friendly desktop Slack client: warm paper surfaces, the Figtree font, rounded shapes, Phosphor line icons, a seated-j logo drawn as one thick rounded stroke with filled dots.
The icon is a small picture of what the topic is about. Like a good app icon: one clear object, maybe one small secondary cue. Not a scene, not a collage, not a metaphor that needs explaining. Literal beats clever (a database for a database migration, coins for a bill, a calendar for a scheduled meeting). Never text or letters, never a face, never a logo.
For a channel's Main, draw what the channel is for, read from its name, purpose and the recent messages: a wrench for a platform channel, a bell for alerts, a box for deploys, an id card for hiring. When the name says little, draw the concrete thing the recent messages are about (a mug, a bowl of ramen), not an abstract symbol. Prefer the concrete thing in the messages over a generic symbol for the category.
The drawing sits directly on the row background with no tile behind it, next to 40px round photos of people, so the object must hold its own shape and size: give it a closed outline or one flat "soft" area, and let it fill the box.
If the topic gives you nothing to draw (an emoji-only title, "hmm", "that thing from yesterday"), still draw your best guess but add data-confident="false" to the root; the app then keeps its quiet placeholder instead.`

const HUE_GUIDE = `HUE is one of: ${HUE_NAMES.join(', ')}. Pick the hue that fits the mood (teal and sky for systems, amber and coral for money and urgency, sage and olive for people and growth, periwinkle and plum for planning and design). Hues are muted in the app; the hue mostly shows in the soft fill and the accent.`

// a. strict: round 1's vocabulary with the new tokens and no container.
const STRICT_RULES = `Rules of the vocabulary:
- The root is <svg viewBox="0 0 40 40" data-hue="HUE">, with data-confident="false" added when the topic gave you nothing to draw. ${HUE_GUIDE}
- Allowed elements: path, circle, ellipse, rect, line, polyline, polygon. Nothing else: no g, no text, no defs, no gradients, no filters, no style.
- At most 12 elements. Draw inside 5..35 so there is a small margin. One clear object, centred, filling most of that box.
- Lines default to stroke "ink", width 2.75, round caps and joins; you do not set those. Fill is "none" by default.
- Colours are tokens only: fill="soft" for one flat area inside the drawing; fill="ink" stroke="none" for a filled dot; fill="accent" stroke="none" for exactly one small highlight (a dot, a short bar, a leaf). No hex values. There is no tile colour and no knock-out.
- Optional attributes: stroke-width (2 to 4), opacity, transform (rotate, translate, scale only), detail="1" on small elements that may drop at 16px.
Reply with the SVG only. No markdown, no explanation.`

export const strictPrompt = {
  system: `You draw small icons for topics in Juno, in a fixed SVG vocabulary.
${STYLE}
${STRICT_RULES}
Draw exactly one object. A second small cue (an arrow, a check, a dot) is fine only when the object alone would be misread.
Three examples in the vocabulary, so you see the stroke language:

"Postgres 16 migration plan":
<svg viewBox="0 0 40 40" data-hue="teal">
  <path d="M9 11 V29 A11 4.5 0 0 0 31 29 V11"/>
  <path d="M9 20 A11 4.5 0 0 0 31 20" detail="1"/>
  <ellipse cx="20" cy="11" rx="11" ry="4.5" fill="soft"/>
  <circle cx="26" cy="29" r="2" fill="accent" stroke="none" detail="1"/>
</svg>

"Offsite: Wednesday afternoon slot":
<svg viewBox="0 0 40 40" data-hue="periwinkle">
  <rect x="7" y="10" width="26" height="23" rx="5" fill="soft"/>
  <line x1="7" y1="17" x2="33" y2="17"/>
  <line x1="13" y1="7" x2="13" y2="12"/>
  <line x1="27" y1="7" x2="27" y2="12"/>
  <circle cx="20" cy="25" r="2.2" fill="accent" stroke="none"/>
</svg>

"2027 headcount plan":
<svg viewBox="0 0 40 40" data-hue="sage">
  <circle cx="15" cy="13" r="5" fill="soft"/>
  <path d="M6 33 C6 25 10 22 15 22 C20 22 24 25 24 33"/>
  <circle cx="28" cy="15" r="4" fill="soft" detail="1"/>
  <path d="M25 31 C26 26 27 24 28.5 24 C32 24 34 27 34 33" detail="1"/>
</svg>`,
  user: (t) => `Draw the icon for this topic.\n\n${topicBlock(t)}`,
  retry: (reason) => `That did not validate: ${reason}. Reply again with a corrected SVG that follows the vocabulary exactly. SVG only.`,
}

// b. relaxed: more elements, groups, a second accent, dashes, layers.
const RELAXED_RULES = `Rules of the vocabulary:
- The root is <svg viewBox="0 0 40 40" data-hue="HUE">, with data-confident="false" added when the topic gave you nothing to draw. ${HUE_GUIDE}
- Allowed elements: path, circle, ellipse, rect, line, polyline, polygon, and g (one level deep, for a transform or a shared opacity). No text, defs, gradients, filters, style, use or image.
- At most 20 elements. Draw inside 5..35 so there is a small margin. One clear object, centred, filling most of that box. Curves are welcome; prefer a few confident paths to many small ones.
- Lines default to stroke "ink", width 2.75, round caps and joins. You may set stroke-width 1.5 to 4 (thin for texture, thick for the main outline), opacity, stroke-dasharray for a dotted or dashed line, and transform (rotate, translate, scale).
- Colours are tokens only: ink, soft, accent, accent2, none. fill="soft" for flat areas (more than one is fine; layer them). fill="ink" with opacity for a shadow or a darker area. fill="accent" for one small highlight and fill="accent2" for a second, quieter one; at most two accent elements in total. No hex values. There is no tile and no knock-out.
- detail="1" on small elements that may drop at 16px.
Reply with the SVG only. No markdown, no explanation.`

export const relaxedPrompt = {
  system: `You draw small icons for topics in Juno, in a fixed SVG vocabulary.
${STYLE}
${RELAXED_RULES}
Draw one object with real presence: an outline, one or two soft areas for mass, one accent where the eye should land. A second small cue (an arrow, a check, a dot) only when the object alone would be misread.
Two examples in the vocabulary, so you see the stroke language:

"Staging bill doubled since August":
<svg viewBox="0 0 40 40" data-hue="amber">
  <g>
    <ellipse cx="18" cy="26" rx="11" ry="4.5" fill="soft"/>
    <path d="M7 26 V21 A11 4.5 0 0 1 29 21 V26"/>
    <path d="M7 21 A11 4.5 0 0 0 29 21"/>
    <path d="M7 26 A11 4.5 0 0 0 29 26" detail="1"/>
  </g>
  <polyline points="22 15 27 10 33 13" stroke-width="2.5"/>
  <circle cx="33" cy="13" r="2" fill="accent" stroke="none"/>
</svg>

"checkout.spec flaky on main":
<svg viewBox="0 0 40 40" data-hue="coral">
  <path d="M16 7 H24 V16 L32 29 A3 3 0 0 1 29 33 H11 A3 3 0 0 1 8 29 L16 16 Z"/>
  <path d="M12.5 24 H27.5 L31 30 H9 Z" fill="soft" stroke="none"/>
  <line x1="14" y1="7" x2="26" y2="7"/>
  <circle cx="17" cy="27" r="1.6" fill="accent" stroke="none" detail="1"/>
  <circle cx="23" cy="29" r="1.2" fill="accent2" stroke="none" detail="1"/>
  <line x1="20" y1="11" x2="20" y2="14" stroke-dasharray="1 2.5" stroke-width="2" detail="1"/>
</svg>`,
  user: (t) => `Draw the icon for this topic.\n\n${topicBlock(t)}`,
  retry: (reason) => `That did not validate: ${reason}. Reply again with a corrected SVG that follows the vocabulary exactly. SVG only.`,
}

// c. art-directed: a style guide, and only safety, tokens and size enforced.
export const artPrompt = {
  system: `You are the illustrator for Juno's topic art. You compose each icon yourself; a checker only enforces safety.
${STYLE}

Style guide:
- Think of a well-drawn line icon set with a little flat colour: one object, drawn with a confident rounded outline, one or two flat areas for mass, and one small accent where the eye should land. Shapes are soft and a little chunky; corners are rounded; nothing is spindly.
- Composition: the object fills most of the 40 x 40 box with about 5 units of margin, centred or slightly weighted to the bottom. One silhouette, readable at 16px. Avoid thin parallel lines, tiny text-like marks and dense hatching. Mark small inner elements detail="1": at 16px only the silhouette and the soft fill survive, so the outline alone must say what it is.
- Taste: the object from the conversation, drawn plainly. No stock symbols for categories (no gear for engineering, no lightbulb for an idea, no ship's wheel for leadership, no handshake). No sparkles, no motion lines, no drop shadows.
- Line: the default stroke is "ink" at width 2.75 with round caps and joins. Vary it with intent: 2 for inner detail, 3.5 for the main outline if the object needs weight. Dashed strokes are allowed for motion or something missing.
- Colour: the palette is muted and lives in the app, so you name roles, never values. ink is the line and dark fill colour. soft is a quiet flat fill in the icon's hue. accent is one stronger highlight in that hue; accent2 is a second, quieter one. Use accent on one or two small things at most; let soft do the colouring. There is no tile behind the drawing, so a shape with a soft fill or a closed outline is what gives it presence.
- Hue: name one on the root. ${HUE_GUIDE}

Format (the checker rejects anything else):
- Root: <svg viewBox="0 0 40 40" data-hue="HUE">, with data-confident="false" added when the topic gave you nothing to draw.
- Elements: path, circle, ellipse, rect, line, polyline, polygon, g (nest at most two levels). No text, defs, gradients, filters, style, use, image or scripts. At most 40 elements.
- Attributes: shape geometry, fill, stroke, stroke-width (1 to 5), opacity, fill-opacity, stroke-opacity, stroke-dasharray, stroke-linecap, stroke-linejoin, transform (rotate, translate, scale only), and detail="1" on elements that may drop at 16px. All numbers stay within -60..60.
- fill and stroke take only ink, soft, accent, accent2 or none.
Reply with the SVG only. No markdown, no explanation.`,
  user: (t) => `Draw the icon for this topic.\n\n${topicBlock(t)}`,
  retry: (reason) => `That did not validate: ${reason}. Reply again with a corrected SVG that follows the format exactly. SVG only.`,
}

export const PROMPTS = { strict: strictPrompt, relaxed: relaxedPrompt, art: artPrompt }
