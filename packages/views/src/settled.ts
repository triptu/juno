import type { SettledWhy } from '@juno/contract'

/** What the user did with a proposal while the review is open. */
export type SettledStatus = 'open' | 'resolved' | 'kept'

/** The words Tidy up uses, shared by the review and Settings › Tidy up (SPEC 12 and 14). */
export const settledCopy = {
  title: (count: number) => (count === 1 ? '1 topic looks settled' : `${count} topics look settled`),
  lead: 'Juno thinks these are finished. Open one to check it first.',
  about: 'What Resolve does',
  explain: [
    'Hides the topic from the sidebar. It stays in All topics, under Resolved.',
    'Marks it read. Nothing is posted to Slack. With Mark messages read in Slack too on, Slack shows it read on your other devices.',
    'A new message brings it back to the sidebar, tagged Reopened.',
    'Keep open stops Juno suggesting it until someone writes in it again.',
  ],
  settings: 'Tidy up settings',
  resolve: 'Resolve',
  keep: 'Keep open',
  undo: 'Undo',
  resolved: 'Resolved',
  kept: 'Kept open',
  resolveAll: 'Resolve all',
  done: 'Done',
} as const

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A quiet stretch in words: "40 minutes", "3 hours", "1 day", "6 days", "2 weeks". */
export function quietSpan(millis: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (millis < HOUR) return plural(Math.max(1, Math.floor(millis / MINUTE)), 'minute')
  if (millis < DAY) return plural(Math.floor(millis / HOUR), 'hour')
  if (millis < 14 * DAY) return plural(Math.floor(millis / DAY), 'day')
  return plural(Math.floor(millis / (7 * DAY)), 'week')
}

/**
 * Why a topic looks settled, in plain words, from what its last messages
 * showed: "Ended with a thank-you from Maya", "No replies for 6 days after
 * your answer". With no closing words, the decision's own clause when it
 * gave one, marked as Juno's.
 */
export function settledReason(why: SettledWhy, at: number | undefined, now: number): string {
  const span = at === undefined ? undefined : quietSpan(Math.max(0, now - at))
  switch (why.kind) {
    case 'thanks':
      return why.by === undefined ? 'Ended with your thank-you' : `Ended with a thank-you from ${why.by}`
    case 'done':
      return why.by === undefined ? "You said it's done" : `${why.by} said it's done`
    case 'agreed':
      return why.by === undefined ? 'Ended with your OK' : `Ended with an OK from ${why.by}`
    case 'afterYou':
      return span === undefined ? 'No replies after your answer' : `No replies for ${span} after your answer`
    case 'quiet':
      if (why.juno !== undefined) return `Juno: ${why.juno}`
      return span === undefined ? 'No replies since' : `No replies for ${span}`
  }
}

/** Tidy up's meta line on Home: where the topics are, "eng, incidents and 3 more". Titles made from a first message's words read badly in a list. */
export function placesLine(places: ReadonlyArray<string>): string {
  const unique = [...new Set(places.filter((place) => place !== ''))]
  if (unique.length <= 3) return unique.length <= 1 ? (unique[0] ?? '') : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
  return `${unique.slice(0, 2).join(', ')} and ${unique.length - 2} more`
}
