import type { HomeTopic } from '@juno/contract'
import type { ReviewAbout } from './ReviewSheet'
import type { ReviewEntry, ReviewVerbs, ReviewWords } from './reviewModel'
import { relativeTime } from './time'

/** The words Automated's record uses (SPEC 12, "Automated, with a record"). */
export const automatedMovesCopy = {
  lead: 'Juno moved these by itself. Move one back if it belongs where it was.',
  about: 'What Automated is',
  explain: [
    'Automated keeps bot and alert channels, and DMs with apps, out of All.',
    'Juno moves a channel in when apps start nearly all its conversations, and back when people start most of them. Replies in threads do not count.',
    'Nothing changes in Slack. You stay in every channel.',
    'After Move back or Keep, Juno leaves that channel where you chose.',
  ],
} as const

const IN: ReviewWords = { act: 'Move back', decline: 'Keep', done: 'Moved back to All', declined: 'Kept in Automated' }
const OUT: ReviewWords = { act: 'Move to Automated', decline: 'Keep', done: 'Moved to Automated', declined: 'Kept in All' }

/** The record's keys: M takes a row's main action, K keeps. A row's own words say which way it moves. */
export const movedVerbs: ReviewVerbs = { ...IN, actKey: 'M', declineKey: 'K' }

export const movedAbout: ReviewAbout = { label: automatedMovesCopy.about, lines: automatedMovesCopy.explain }

/**
 * The moves as review rows: Move back and Keep for a move in, Move to
 * Automated and Keep for a move back out; the fact that decided it, then
 * Juno's own reason or the counts, and when.
 */
export function movedEntries(topics: ReadonlyArray<HomeTopic>, now: number): ReadonlyArray<ReviewEntry> {
  return topics.map((topic) => ({
    id: topic.id,
    topicId: topic.id,
    title: topic.title,
    ...(topic.art === undefined ? {} : { art: topic.art }),
    ...(topic.moved?.reason === undefined ? {} : { reason: topic.moved.reason }),
    meta: [topic.moved?.detail, topic.at === undefined ? undefined : relativeTime(topic.at, now)].filter((part) => part !== undefined && part !== '').join(' · '),
    words: topic.moved?.change === 'out' ? OUT : IN,
  }))
}

/** The toast after a row's action, with the channel's label: "Moved #ci-builds back to All". */
export function movedToast(topic: HomeTopic, action: 'act' | 'keep'): string {
  const label = topic.moved?.channel.label ?? topic.title
  if (topic.moved?.change === 'out') return action === 'act' ? `Moved ${label} to Automated` : `Keeping ${label} in All`
  return action === 'act' ? `Moved ${label} back to All` : `Keeping ${label} in Automated`
}
