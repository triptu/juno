import type { HomeTopic } from '@juno/contract'
import type { ReviewRowCopy, ReviewRowLines } from './SettledList'
import { relativeTime } from './time'

/** The words Automated's record uses (SPEC 12, "Automated, with a record"). */
export const automatedMovesCopy = {
  lead: 'Juno moved these by itself. Move one back if it belongs where it was.',
  about: 'What Automated is',
  explain: [
    'Automated holds bot and alert channels and DMs with apps, so they stay out of All. Its pill in the sidebar shows them.',
    'Juno moves a channel there when apps write most of its top-level messages and people rarely start conversations in it. Replies in threads do not count.',
    'When people start most conversations in a channel again, Juno moves it back.',
    'Nothing changes in Slack. You stay in every channel, and nothing is posted, muted or marked read.',
    'Move back and Keep are your choice, and Juno does not move that channel again.',
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
