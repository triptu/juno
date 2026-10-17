import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import type { HomeTopic, UnopenedWhy } from '@juno/contract'
import type { CardReviewProps } from './ReviewCards'
import { ReviewSheet, type ReviewAbout } from './ReviewSheet'
import { metaLine, type ReviewEntry, type ReviewVerbs } from './reviewModel'
import { quietSpan, settledCopy } from './settled'
import { relativeTime } from './time'

/**
 * The reviews of threads you never open and channels you never read
 * (`docs/design/settled-suggestions/README.md`, "More self-management",
 * cards 1 and 6; SPEC 12). Unfollow writes to Slack, so its lead says so;
 * Ignore is Juno's own, so its lead says nothing changes in Slack.
 */

/** The words of the Unfollow review. */
export const unfollowCopy = {
  title: (count: number) => (count === 1 ? '1 thread you never open' : `${count} threads you never open`),
  lead: 'You follow these, but have not read them in two weeks. Unfollow also unfollows in Slack, on all your devices. A mention of you follows it again.',
  about: {
    label: 'What Unfollow does',
    lines: [
      'Unfollows the thread in Slack, the same as Notify me › Never. It leaves the sidebar, and Slack stops notifying you about it on every device.',
      'It stays in All topics, under Unfollowed.',
      'When someone mentions you in it, you follow it again, as in Slack.',
      'Keep following stops Juno suggesting it until two more weeks of replies go unread.',
    ],
    settings: settledCopy.settings,
  } satisfies ReviewAbout,
  verbs: { act: 'Unfollow', actIcon: BellSlash, actKey: 'U', decline: 'Keep following', declineKey: 'K', done: 'Unfollowed', declined: 'Following' } satisfies ReviewVerbs,
} as const

/** The words of the Ignore review. */
export const ignoreCopy = {
  title: (count: number) => (count === 1 ? '1 channel you never read' : `${count} channels you never read`),
  lead: 'You have not read these in 30 days. Ignore hides a channel everywhere in Juno. Nothing changes in Slack.',
  about: {
    label: 'What Ignore does',
    lines: [
      'Hides the channel everywhere in Juno: the sidebar, search and All topics. Nothing changes in Slack, and you stay a member.',
      'Settings › Ignored lists it, and Stop ignoring brings it back.',
      'A mention of you, or of a group you are in, still notifies you and shows on Home. @here and @channel do not.',
      'Keep showing stops Juno suggesting it for another 30 days.',
    ],
    settings: settledCopy.settings,
  } satisfies ReviewAbout,
  verbs: { act: 'Ignore', actIcon: EyeSlash, actKey: 'I', decline: 'Keep showing', declineKey: 'K', done: 'Ignored', declined: 'Showing' } satisfies ReviewVerbs,
} as const

/**
 * The reason line, from the unread stretch the engine found
 * (`unfollowEvidence`, `ignoreEvidence`): "14 replies, never opened", "312
 * messages since the last one you read, 5 weeks ago". "At least" when the
 * cache holds only part of the stretch.
 */
export function unopenedReason(why: UnopenedWhy, unit: 'reply' | 'message', now: number): string {
  const noun = unit === 'reply' ? (why.count === 1 ? 'reply' : 'replies') : why.count === 1 ? 'message' : 'messages'
  const count = `${why.atLeast ? 'At least ' : ''}${why.count} ${noun}`
  if (why.lastRead === undefined) return `${count}, never opened`
  return `${count} since the last one you read, ${quietSpan(Math.max(0, now - why.lastRead))} ago`
}

/** The proposals as review rows: the thread or channel, its reason, and where it is and when it last moved. */
export function unopenedEntries(topics: ReadonlyArray<HomeTopic>, unit: 'reply' | 'message', now: number): ReadonlyArray<ReviewEntry> {
  return topics.flatMap((topic) => {
    const why = topic.unopened
    if (why === undefined) return []
    const meta = metaLine(topic.place, topic.at === undefined ? undefined : relativeTime(topic.at, now))
    return [{ id: topic.id, topicId: topic.id, title: topic.title, ...(topic.art === undefined ? {} : { art: topic.art }), reason: unopenedReason(why, unit, now), meta }]
  })
}

/** Threads you never open: Unfollow or Keep following per thread. */
export function UnfollowReview({ topics, now, ...rest }: CardReviewProps) {
  const entries = unopenedEntries(topics, 'reply', now)
  return <ReviewSheet name="unfollow" title={unfollowCopy.title(entries.length)} lead={unfollowCopy.lead} about={unfollowCopy.about} verbs={unfollowCopy.verbs} entries={entries} {...rest} />
}

/** Channels you never read: Ignore or Keep showing per channel. */
export function IgnoreReview({ topics, now, ...rest }: CardReviewProps) {
  const entries = unopenedEntries(topics, 'message', now)
  return <ReviewSheet name="ignore" title={ignoreCopy.title(entries.length)} lead={ignoreCopy.lead} about={ignoreCopy.about} verbs={ignoreCopy.verbs} entries={entries} {...rest} />
}
