import type { Person } from '@juno/contract'
import { channel, customEmoji, customReaction, me, mention, p, reaction, unknownReaction, window } from './messages'
import { channels, people } from './topics'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * A day of a real DM-like Main, the shapes that showed the 2026-10-16 gaps:
 * short and long names side by side, a message that is only an @mention, one
 * that is only a #channel chip, runs of short replies, reactions on a few
 * messages next to many without, custom emoji in a chip and on a line, and a
 * custom reaction the workspace does not know. Read by the message geometry
 * checks (apps/gallery/message-geometry.spec.ts).
 */
const alexandra: Person = { id: 'U0ALEXANDRA', name: 'Alexandra Montgomery-Rutherford', color: 'jordy' }
export const conversation = window([
  { ago: 26 * HOUR / MINUTE, from: me, blocks: [p(mention(people.priya))] },
  { ago: 26 * HOUR / MINUTE - 1, from: me, blocks: [p(channel(channels.eng))] },
  { ago: 26 * HOUR / MINUTE - 9, from: people.dev, text: 'got it, thanks!' },
  { ago: 5 * HOUR / MINUTE, from: me, text: 'did the privacy change go out to everyone?' },
  { ago: 5 * HOUR / MINUTE - 4, from: people.dev, text: 'yep' },
  { ago: 5 * HOUR / MINUTE - 5, from: people.dev, text: "they have to switch it on, it's not on by default", reactions: [customReaction('makes-sense', 1)] },
  { ago: 5 * HOUR / MINUTE - 7, from: alexandra, text: 'Can we turn it on for the beta group first?' },
  { ago: 5 * HOUR / MINUTE - 8, from: alexandra, blocks: [p('That would match what we told them ', customEmoji('makes-sense'))] },
  { ago: 3 * HOUR / MINUTE, from: people.sam, text: 'ok' },
  { ago: 3 * HOUR / MINUTE - 2, from: me, text: 'I will flip it after standup.', reactions: [reaction('+1', '👍', 2), unknownReaction('shipit-old', 1)] },
  { ago: 3 * HOUR / MINUTE - 3, from: people.sam, text: 'thanks' },
])
