import type { HomeTopic } from '@juno/contract'
import { Button } from '@juno/ui'
import { automatedMovesCopy, movedCopy, movedLines } from './automatedMoves'
import { ReviewExplainer, ReviewSheet } from './ReviewSheet'
import type { SettledStatus } from './settled'
import { SettledList, type SettledRowProps } from './SettledList'

export interface AutomatedReviewProps {
  /** The card's title: "Juno moved 2 channels to Automated". */
  readonly title: string
  /** The Mains of the channels moved, each with its `moved`. */
  readonly topics: ReadonlyArray<HomeTopic>
  /** `resolved` is Move back (or Move to Automated); `kept` is Keep. */
  readonly statuses: ReadonlyMap<string, SettledStatus>
  readonly now: number
  /** Start with What Automated is open; the gallery shows it. */
  readonly initialAbout?: boolean
  readonly initialActive?: string
  readonly autoFocus?: boolean
  readonly onOpen: SettledRowProps['onOpen']
  readonly onMoveBack: (topicId: string) => void
  readonly onKeep: SettledRowProps['onKeep']
  readonly onUndo: SettledRowProps['onUndo']
  readonly onClose: () => void
}

const KEYS = [
  ['↑↓', 'Move'],
  ['↵', 'Open'],
  ['M', 'Move back'],
  ['K', 'Keep'],
] as const

/**
 * Automated's record (SPEC 12): the channels Juno moved into Automated or
 * back out by itself, each with the fact that decided it, Move back and
 * Keep. The same sheet as Tidy up's review, with the same keys, except M
 * for Move back. The info button says what Automated is and that nothing
 * changes in Slack.
 */
export function AutomatedReview({ title, topics, statuses, now, initialAbout = false, initialActive, autoFocus = false, onOpen, onMoveBack, onKeep, onUndo, onClose }: AutomatedReviewProps) {
  return (
    <ReviewSheet
      sheet="automated"
      title={title}
      lead={automatedMovesCopy.lead}
      aboutLabel={automatedMovesCopy.about}
      about={<ReviewExplainer title={automatedMovesCopy.about} lines={automatedMovesCopy.explain} />}
      initialAbout={initialAbout}
      keys={KEYS}
      buttons={
        <Button variant="primary" size="md" onClick={onClose} data-settled-close="">
          {automatedMovesCopy.done}
        </Button>
      }
    >
      <SettledList
        topics={topics}
        statuses={statuses}
        now={now}
        label={title}
        initialActive={initialActive}
        autoFocus={autoFocus}
        copyOf={movedCopy}
        linesOf={(topic) => movedLines(topic, now)}
        actKey="M"
        onOpen={onOpen}
        onResolve={onMoveBack}
        onKeep={onKeep}
        onUndo={onUndo}
      />
    </ReviewSheet>
  )
}
