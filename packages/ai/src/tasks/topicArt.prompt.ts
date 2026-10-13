/**
 * The art-directed brief from the design study (`docs/design/topic-art/v2/prompts.mjs`,
 * `artPrompt`): a style guide in prose and the format the checker enforces.
 * The checker is `@juno/topic-art`'s `parseRecipe`; its reason goes back to
 * the model once through `retry`.
 */
import { HUE_NAMES } from '@juno/topic-art'
import type { TopicArtInput } from './topicArt'

const STYLE = `Juno is a calm, friendly desktop Slack client: warm paper surfaces, the Figtree font, rounded shapes, Phosphor line icons, a seated-j logo drawn as one thick rounded stroke with filled dots.
The icon is a small picture of what the topic is about. Like a good app icon: one clear object, maybe one small secondary cue. Not a scene, not a collage, not a metaphor that needs explaining. Literal beats clever (a database for a database migration, coins for a bill, a calendar for a scheduled meeting). Never text or letters, never a face, never a logo.
For a channel's Main, draw what the channel is for, read from its name, purpose and the recent messages: a wrench for a platform channel, a bell for alerts, a box for deploys, an id card for hiring. When the name says little, draw the concrete thing the recent messages are about (a mug, a bowl of ramen), not an abstract symbol. Prefer the concrete thing in the messages over a generic symbol for the category.
The drawing sits directly on the row background with no tile behind it, next to 40px round photos of people, so the object must hold its own shape and size: give it a closed outline or one flat "soft" area, and let it fill the box.
If the topic gives you nothing to draw (an emoji-only title, "hmm", "that thing from yesterday"), still draw your best guess but add data-confident="false" to the root; the app then keeps its quiet placeholder instead.`

const HUE_GUIDE = `HUE is one of: ${HUE_NAMES.join(', ')}. Pick the hue that fits the mood (teal and sky for systems, amber and coral for money and urgency, sage and olive for people and growth, periwinkle and plum for planning and design). Hues are muted in the app; the hue mostly shows in the soft fill and the accent.`

export const prompt = `You are the illustrator for Juno's topic art. You compose each icon yourself; a checker only enforces safety.
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
Reply with the SVG only. No markdown, no explanation.`

/** The topic as the model reads it. */
export function topicBlock(input: TopicArtInput): string {
  const lines =
    input.kind === 'main'
      ? [
          `Kind: a channel's Main (the stream of messages outside threads)`,
          `Channel: ${input.channel}`,
          input.purpose ? `Purpose: ${input.purpose}` : undefined,
          input.topic ? `Topic: ${input.topic}` : undefined,
          `Recent messages:`,
          ...input.recent.map((text) => `- ${text}`),
        ]
      : [
          `Kind: a thread`,
          `Title: ${input.title}`,
          `Channel: ${input.channel}`,
          `First message: ${input.first}`,
          `Latest message: ${input.last}`,
        ]
  const avoid = input.avoid === undefined ? [] : ['', `Draw it differently this time: the previous drawing was ${input.avoid.hue} and read as "${input.avoid.summary}". Pick another hue and another object or angle.`]
  return [...lines.filter((line): line is string => line !== undefined), ...avoid].join('\n')
}

export const retryPrompt = (reason: string): string => `That did not validate: ${reason}. Reply again with a corrected SVG that follows the format exactly. SVG only.`
