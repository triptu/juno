// The four briefs. Every approach sees the same topic block; what differs
// is what the model may answer with.
import { HUE_NAMES } from './palette.mjs'
import { motifIndex, motifs } from './motifs.mjs'
import { serialise } from './vocab.mjs'

export function topicBlock(t) {
  return [
    `Title: ${t.title}`,
    `Channel: ${t.channel}`,
    `First message: ${t.first}`,
    `Latest message: ${t.last}`,
  ].join('\n')
}

const STYLE = `Juno is a calm, friendly desktop Slack client: warm paper surfaces, the Figtree font, rounded shapes, Phosphor line icons, a seated-j logo drawn as one thick rounded stroke with filled dots.
The icon is a small picture of what the topic is about. Like a good app icon: one clear object, maybe one small secondary cue. Not a scene, not a collage, not a metaphor that needs explaining. Literal beats clever (a database for a database migration, coins for a bill, a calendar for a scheduled meeting). Never text or letters, never a face, never a logo.`

// A. Free SVG with a prose brief.
export const freePrompt = {
  system: `You draw small SVG icons for topics in Juno.
${STYLE}
Draw on a 40 x 40 viewBox with about 4px of margin. Rounded line style, stroke 3, round caps and joins, at most three colours that suit warm paper (for example a deep teal #2E5F6B for lines, a pale fill #CFE3E8, and one small coral #CC4628 highlight). Keep it under about 12 shapes so it still reads at 16px.
Reply with the SVG only. No markdown, no explanation.`,
  user: (t) => `Draw the icon for this topic.\n\n${topicBlock(t)}`,
}

// B. Constrained vocabulary.
const VOCAB = `Rules of the vocabulary:
- The root is <svg viewBox="0 0 40 40" data-hue="HUE"> where HUE is one of: ${HUE_NAMES.join(', ')}. Pick the hue that fits the mood (teal and sky for systems, amber and coral for money and urgency, sage and olive for people and growth, periwinkle and plum for planning and design).
- Allowed elements: path, circle, ellipse, rect, line, polyline, polygon. Nothing else: no g, no text, no defs, no gradients, no filters, no style.
- At most 12 elements. Draw inside 7..33 so there is margin. One clear object, centred.
- Lines default to stroke "ink", width 3, round caps and joins; you do not set those. Fill is "none" by default.
- Colours are tokens only: fill="soft" for one flat area inside the drawing, fill="ink" stroke="none" for a filled dot, fill="accent" stroke="none" for at most one small highlight dot, fill="tile" to knock a hole. No hex values.
- Optional attributes: stroke-width (2 to 4), opacity, transform (rotate, translate, scale only), detail="1" on small elements that may drop at 16px.
Reply with the SVG only. No markdown, no explanation.`

export const vocabPrompt = {
  system: `You draw small icons for topics in Juno, in a fixed SVG vocabulary.
${STYLE}
${VOCAB}
Draw exactly one object. A second small cue (an arrow, a check, a dot) is fine only when the object alone would be misread.
Three examples in the vocabulary, so you see the stroke language:

"Postgres 16 migration plan":
<svg viewBox="0 0 40 40" data-hue="teal">
  <path d="M10 12 V28 A10 4 0 0 0 30 28 V12"/>
  <path d="M10 20 A10 4 0 0 0 30 20" detail="1"/>
  <ellipse cx="20" cy="12" rx="10" ry="4" fill="soft"/>
</svg>

"Offsite: Wednesday afternoon slot":
<svg viewBox="0 0 40 40" data-hue="periwinkle">
  <rect x="9" y="11" width="22" height="20" rx="4" fill="soft"/>
  <line x1="9" y1="17" x2="31" y2="17"/>
  <line x1="14" y1="8" x2="14" y2="13"/>
  <line x1="26" y1="8" x2="26" y2="13"/>
  <circle cx="20" cy="24" r="2" fill="accent" stroke="none"/>
</svg>

"2027 headcount plan":
<svg viewBox="0 0 40 40" data-hue="sage">
  <circle cx="15" cy="14" r="4.5" fill="soft"/>
  <path d="M7 31 C7 24 10.5 21 15 21 C19.5 21 23 24 23 31"/>
  <circle cx="27" cy="15" r="3.5" fill="soft" detail="1"/>
  <path d="M24 29 C25 24.5 26 23 27.5 23 C31 23 33 26 33 31" detail="1"/>
</svg>`,
  user: (t) => `Draw the icon for this topic.\n\n${topicBlock(t)}`,
  retry: (reason) => `That did not validate: ${reason}. Reply again with a corrected SVG that follows the vocabulary exactly. SVG only.`,
}

// C. Motif kit: the model only decides.
export const kitPrompt = {
  system: `You pick the icon for a topic in Juno from a fixed kit of motifs.
${STYLE}
Answer with JSON only: {"main": "<motif>", "secondary": "<motif or null>", "hue": "<hue>", "confident": true|false, "why": "<ten words>"}.
- main: the one motif that says what the topic is about. Literal beats clever.
- secondary: null for most topics. A small corner badge is only worth it when the title would be misread without it: arrow-right turns a database into a migration, chart-up turns coins into a rising bill, trash turns a flag into a cleanup. If the main motif alone already says it, answer null. Never repeat the main motif.
- hue: one of ${HUE_NAMES.join(', ')}. Teal and sky for systems, amber and coral for money and urgency, sage and olive for people and growth, periwinkle and plum for planning and design.
- confident: false when the topic gives you nothing to draw (an emoji-only title, "hmm", "that thing"). The app then keeps the channel's mark instead. Still fill in main and hue.

The kit:
${motifIndex()}`,
  user: (t) => `Pick the icon for this topic.\n\n${topicBlock(t)}`,
  retry: (reason) => `That did not validate: ${reason}. Answer again with JSON only, using motif names from the kit exactly as written.`,
}

// D. The vocabulary plus the kit as an element: <motif name="database" x="0" y="0" scale="1"/>.
// The model may place kit motifs, draw its own strokes, or mix the two.
const examples = ['database', 'coins', 'calendar', 'people', 'bug', 'rocket']
  .map((n) => `${n}:\n${serialise({ hue: 'teal', elements: motifs[n].elements })}`)
  .join('\n\n')

export const hybridPrompt = {
  system: `You draw small icons for topics in Juno, in a fixed SVG vocabulary, with a kit of ready motifs you can place.
${STYLE}
${VOCAB}
- One more element: <motif name="NAME" x="0" y="0" scale="1"/> places a kit motif. x and y translate it, scale shrinks it (keep 0.4 to 1). A full-size motif fills 7..33. For a main motif with a small secondary cue, place the main at x="-2" y="-2" scale="0.9" and the secondary at x="21" y="21" scale="0.45", with a <circle cx="30" cy="30" r="9" fill="tile" stroke="none" detail="1"/> knock-out between them.
- Prefer a kit motif when one fits. Draw your own shapes only for something the kit lacks, or to add a detail. Keep the same stroke language as the kit.

The kit (name: meaning):
${motifIndex()}

A few kit motifs written out, so you see the stroke language:

${examples}

Reply with the SVG only. No markdown, no explanation.`,
  user: (t) => `Draw the icon for this topic.\n\n${topicBlock(t)}`,
  retry: (reason) => `That did not validate: ${reason}. Reply again with a corrected SVG that follows the vocabulary exactly. SVG only.`,
}
