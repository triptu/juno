import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import type { FollowUpMatch, HomeTopic, OldDraft } from '@juno/contract'
import { ReviewSheet, type ReviewAbout, type ReviewSheetProps } from './Review'
import type { ReviewEntry, ReviewVerbs } from './reviewModel'
import { quietSpan } from './settled'
import { relativeTime } from './time'

/**
 * The reviews of follow-ups that look done and of old drafts
 * (`docs/design/settled-suggestions/README.md`, "More self-management",
 * cards 4 and 5; SPEC 12). Both say what happens in Slack: nothing.
 */

const SETTINGS = 'Tidy up settings'

/** The words of the review of follow-ups that look done. */
export const doneFollowUpsCopy = {
  title: (count: number) => (count === 1 ? '1 follow-up looks done' : `${count} follow-ups look done`),
  lead: 'A later message of yours seems to keep each promise. Check the quoted message.',
  about: {
    label: 'What Mark done does',
    lines: [
      'Takes the promise off Follow-up. Nothing is posted to Slack.',
      'Juno matched a later message of yours in the same topic: one with a file, a link, or words like "Here\'s" or "Done".',
      'Not done keeps the promise in Follow-up. Juno suggests it again only for a newer message.',
    ],
    settings: SETTINGS,
  } satisfies ReviewAbout,
  verbs: { act: 'Mark done', actIcon: Check, actKey: 'D', decline: 'Not done', declineKey: 'N', done: 'Marked done', declined: 'Kept in Follow-up' } satisfies ReviewVerbs,
} as const

/** The words of the review of old drafts. */
export const oldDraftsCopy = {
  title: (count: number) => (count === 1 ? '1 old draft' : `${count} old drafts`),
  lead: 'Drafts untouched for two weeks, in topics that moved on since.',
  about: {
    label: 'What Delete does',
    lines: [
      'Deletes the draft in Juno. It was never sent, so nothing changes in Slack.',
      'Undo puts it back as it was.',
      'Keep stops Juno suggesting this draft. Editing it starts the two weeks again.',
    ],
    settings: SETTINGS,
  } satisfies ReviewAbout,
  verbs: { act: 'Delete', actIcon: Trash, actKey: 'D', decline: 'Keep', declineKey: 'K', done: 'Deleted', declined: 'Kept' } satisfies ReviewVerbs,
} as const

/** What the matching message shows, and how long after the promise: "You shared a file 2 hours later". */
export function deliveryReason(match: FollowUpMatch): string {
  const span = quietSpan(Math.max(0, (Number(match.ts) - Number(match.promiseTs)) * 1000))
  switch (match.kind) {
    case 'file':
      return `You shared a file ${span} later`
    case 'link':
      return `You posted a link ${span} later`
    case 'said':
      return `You replied ${span} later`
  }
}

const metaLine = (...parts: ReadonlyArray<string | undefined>) => parts.filter((part) => part !== undefined && part !== '').join(' · ')

/** The promises as review rows: the promise, why it looks done, the matching message, and where and when it was made. */
export function doneFollowUpEntries(topics: ReadonlyArray<HomeTopic>, now: number): ReadonlyArray<ReviewEntry> {
  return topics.flatMap((topic) => {
    const match = topic.followUp
    if (match === undefined) return []
    return [{ id: topic.id, topicId: topic.id, title: match.promise, ...(topic.art === undefined ? {} : { art: topic.art }), reason: deliveryReason(match), quote: match.text, meta: metaLine(topic.title, topic.place, topic.at === undefined ? undefined : relativeTime(topic.at, now)) }]
  })
}

/** How old a draft is and how far its topic moved: "Untouched for 3 weeks · 12 messages since". */
export function draftReason(draft: OldDraft, now: number): string {
  const count = draft.more === true ? `${draft.since}+ messages` : draft.since === 1 ? '1 message' : `${draft.since} messages`
  return `Untouched for ${quietSpan(Math.max(0, now - draft.at))} · ${count} since`
}

/** The drafts as review rows: the topic, the draft's age, its first line, and where it is. */
export function oldDraftEntries(topics: ReadonlyArray<HomeTopic>, now: number): ReadonlyArray<ReviewEntry> {
  return topics.flatMap((topic) => {
    const draft = topic.draft
    if (draft === undefined) return []
    return [{ id: topic.id, topicId: topic.id, title: topic.title, ...(topic.art === undefined ? {} : { art: topic.art }), reason: draftReason(draft, now), quote: draft.text, meta: topic.place }]
  })
}

export interface CardReviewProps extends Omit<ReviewSheetProps, 'name' | 'title' | 'lead' | 'about' | 'verbs' | 'entries' | 'all' | 'onAll'> {
  readonly topics: ReadonlyArray<HomeTopic>
  readonly now: number
}

/** Follow-ups that look done: Mark done or Not done per promise. */
export function DoneFollowUpsReview({ topics, now, ...rest }: CardReviewProps) {
  const entries = doneFollowUpEntries(topics, now)
  return <ReviewSheet name="doneFollowUps" title={doneFollowUpsCopy.title(entries.length)} lead={doneFollowUpsCopy.lead} about={doneFollowUpsCopy.about} verbs={doneFollowUpsCopy.verbs} entries={entries} {...rest} />
}

/** Old drafts: Delete or Keep per draft. */
export function OldDraftsReview({ topics, now, ...rest }: CardReviewProps) {
  const entries = oldDraftEntries(topics, now)
  return <ReviewSheet name="oldDrafts" title={oldDraftsCopy.title(entries.length)} lead={oldDraftsCopy.lead} about={oldDraftsCopy.about} verbs={oldDraftsCopy.verbs} entries={entries} {...rest} />
}
