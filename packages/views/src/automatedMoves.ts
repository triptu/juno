import type { HomeTopic } from '@juno/contract'
import type { ReviewRowCopy, ReviewRowLines } from './SettledList'
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
  done: 'Done',
  undo: 'Undo',
  moveBack: 'Move back',
} as const

const IN: ReviewRowCopy = { act: 'Move back', keep: 'Keep', acted: 'Moved back to All', kept: 'Kept in Automated' }
const OUT: ReviewRowCopy = { act: 'Move to Automated', keep: 'Keep', acted: 'Moved to Automated', kept: 'Kept in All' }

/** A row's buttons: Move back and Keep for a move in; Move to Automated and Keep for a move back out. */
export function movedCopy(topic: HomeTopic): ReviewRowCopy {
  return topic.moved?.change === 'out' ? OUT : IN
}

/** A row's lines: the fact that decided the move, then Juno's own reason or the counts, and when. */
export function movedLines(topic: HomeTopic, now: number): ReviewRowLines {
  return {
    reason: topic.moved?.reason,
    meta: [topic.moved?.detail, topic.at === undefined ? undefined : relativeTime(topic.at, now)].filter((part) => part !== undefined && part !== '').join(' · '),
  }
}

/** The toast after a row's action, with the channel's label: "Moved #ci-builds back to All". */
export function movedToast(topic: HomeTopic, action: 'act' | 'keep'): string {
  const label = topic.moved?.channel.label ?? topic.title
  if (topic.moved?.change === 'out') return action === 'act' ? `Moved ${label} to Automated` : `Keeping ${label} in All`
  return action === 'act' ? `Moved ${label} back to All` : `Keeping ${label} in Automated`
}
