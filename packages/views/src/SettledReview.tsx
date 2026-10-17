import { Check } from '@phosphor-icons/react/dist/icons/Check'
import type { HomeTopic } from '@juno/contract'
import { ReviewSheet, type ReviewAbout, type ReviewSheetProps } from './ReviewSheet'
import { tileOf } from './tileModel'
import { metaLine, type ReviewEntry, type ReviewVerbs } from './reviewModel'
import { settledCopy, settledReason } from './settled'
import { relativeTime } from './time'

const settledVerbs: ReviewVerbs = {
  act: settledCopy.resolve,
  actIcon: Check,
  actKey: 'R',
  decline: settledCopy.keep,
  declineKey: 'K',
  done: settledCopy.resolved,
  declined: settledCopy.kept,
}

const settledAbout: ReviewAbout = { label: settledCopy.about, lines: settledCopy.explain, settings: settledCopy.settings }

/** Tidy up's proposals as review rows: the title, why it looks settled, and where it is and when it last moved. */
function settledEntries(topics: ReadonlyArray<HomeTopic>, now: number): ReadonlyArray<ReviewEntry> {
  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    ...tileOf(topic),
    ...(topic.settled === undefined ? {} : { reason: settledReason(topic.settled, topic.at, now) }),
    meta: metaLine(topic.place, topic.at === undefined ? undefined : relativeTime(topic.at, now)),
  }))
}

export interface SettledReviewProps extends Omit<ReviewSheetProps, 'name' | 'title' | 'lead' | 'about' | 'verbs' | 'entries' | 'all'> {
  readonly topics: ReadonlyArray<HomeTopic>
  readonly now: number
}

/**
 * Tidy up's review (SPEC 12): every topic that looks settled, why, and
 * Resolve or Keep open for each; Resolve all and Done at the bottom. The
 * info button says what Resolve does and leads to Settings › Tidy up.
 */
export function SettledReview({ topics, now, ...rest }: SettledReviewProps) {
  return <ReviewSheet name="settled" title={settledCopy.title(topics.length)} lead={settledCopy.lead} about={settledAbout} verbs={settledVerbs} entries={settledEntries(topics, now)} all={settledCopy.resolveAll} {...rest} />
}
