/**
 * Who reacted, as Slack lists it. A message's `reactions[].users` may name
 * fewer people than `count` (Slack's docs); `reactions.get` with `full`
 * names everyone. Live, every reaction up to a count of 25 listed everyone
 * (research section 10, "Who reacted"); where Slack starts to cut the list
 * is not known. The fake cuts it at `REACTORS_LISTED`, a fake choice just
 * above what was seen live, so tests with many reactors exercise the full
 * fetch and the default seed (at most a few per reaction) is untouched.
 */
import type { Message, Reaction } from '@juno/slack-schema'

/** How many people a message's reaction lists at most, outside `reactions.get` with `full`. */
export const REACTORS_LISTED = 25

/** A reaction as a page lists it: `count` exact, `users` cut to `REACTORS_LISTED`. */
export const listedReaction = (reaction: Reaction): Reaction =>
  reaction.users === undefined || reaction.users.length <= REACTORS_LISTED ? reaction : { ...reaction, users: reaction.users.slice(0, REACTORS_LISTED) }

/** The message as a page or an event carries it: every reaction through `listedReaction`. */
export function withListedReactors<M extends Pick<Message, 'reactions'>>(message: M): M {
  const reactions = message.reactions
  if (reactions === undefined || !reactions.some((r) => (r.users?.length ?? 0) > REACTORS_LISTED)) return message
  return { ...message, reactions: reactions.map(listedReaction) }
}
