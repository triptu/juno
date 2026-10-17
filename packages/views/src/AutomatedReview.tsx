import type { HomeTopic } from '@juno/contract'
import { automatedMovesCopy, movedAbout, movedEntries, movedVerbs } from './automatedMoves'
import { ReviewSheet, type ReviewSheetProps } from './ReviewSheet'

export interface AutomatedReviewProps extends Omit<ReviewSheetProps, 'name' | 'lead' | 'about' | 'verbs' | 'entries' | 'all' | 'onAll' | 'onSettings'> {
  /** The Mains of the channels moved, each with its `moved`. */
  readonly topics: ReadonlyArray<HomeTopic>
  readonly now: number
}

/**
 * Automated's record (SPEC 12): the channels Juno moved into Automated or
 * back out by itself, each with the fact that decided it, Move back and
 * Keep. The same sheet as Tidy up's review, with the same keys, except M
 * for Move back. The info button says what Automated is and that nothing
 * changes in Slack. `title` is the card's: "Juno moved 2 channels to Automated".
 */
export function AutomatedReview({ topics, now, ...rest }: AutomatedReviewProps) {
  return <ReviewSheet name="automated" lead={automatedMovesCopy.lead} about={movedAbout} verbs={movedVerbs} entries={movedEntries(topics, now)} {...rest} />
}
