import { useState, type ReactNode } from 'react'
import type { HomeItem } from '@juno/contract'
import { defineFixtures, scene } from '@juno/ui'
import { AutomatedReview, type AutomatedReviewProps } from './AutomatedReview'
import { automatedMovesInItem, automatedMovesItem, movedIn, movedOut, movedTopics } from './fixtures/automatedMoves'
import { homeItems } from './fixtures/home'
import { OverHome as SheetOverHome } from './fixtures/sheetFrame'
import { NOW } from './fixtures/topics'
import { Home } from './Home'
import type { ReviewStatus } from './reviewModel'

const noop = () => {}

/** The record with its buttons working, so the gallery and the shift guard see a row change state in place. */
function Live({ item = automatedMovesItem, initial = new Map(), ...rest }: Partial<AutomatedReviewProps> & { readonly item?: HomeItem; readonly initial?: ReadonlyMap<string, ReviewStatus> }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ReviewStatus>>(initial)
  const set = (id: string, status: ReviewStatus) => setStatuses(new Map([...statuses, [id, status]]))
  return (
    <AutomatedReview
      title={item.title}
      topics={item.topics}
      statuses={statuses}
      now={NOW}
      onOpen={noop}
      onAct={(id) => set(id, 'done')}
      onDecline={(id) => set(id, 'declined')}
      onUndo={(id) => set(id, 'open')}
      onClose={noop}
      {...rest}
    />
  )
}

const homeWith = (item: HomeItem) => (
  <Home scene="morning" title="Morning, Tushar." items={[homeItems.waiting, homeItems.followUp, item]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} onDismiss={noop} />
)

/** Home under the sheet's layer, as the window shows it. */
function OverHome({ children }: { readonly children: ReactNode }) {
  return <SheetOverHome home={homeWith(automatedMovesItem)}>{children}</SheetOverHome>
}

const acted: ReadonlyMap<string, ReviewStatus> = new Map([
  [movedIn[0]!.id, 'done'],
  [movedOut.id, 'declined'],
])

export default defineFixtures(
  AutomatedReview,
  {
    // The sheet over Home: each move with the fact that decided it, Move back and Keep.
    Sheet: {
      'over-home': scene(() => <OverHome><Live /></OverHome>),
      'moved-in-only': scene(() => <OverHome><Live item={automatedMovesInItem} /></OverHome>),
      about: scene(() => <OverHome><Live initialAbout /></OverHome>),
      // One moved back, one kept: each row stays where it was and says what happened, with Undo.
      acted: scene(() => <OverHome><Live initial={acted} /></OverHome>),
      'focus-row': scene(() => <OverHome><Live initialActive={movedTopics[1]!.id} /></OverHome>, { focus: `[data-review-row="${movedTopics[1]!.id}"] a` }),
      'minimum-window': scene(() => <OverHome><Live /></OverHome>, { width: 336, height: 436, padded: false }),
    },
    // Home's card: the whole row opens the record.
    Card: {
      card: scene(() => homeWith(automatedMovesInItem), { hover: '[data-home-item="automatedMoves"] [data-home-review]' }),
      'card-mixed': scene(() => homeWith(automatedMovesItem)),
      'card-focus': scene(() => homeWith(automatedMovesInItem), { focus: '[data-home-item="automatedMoves"] [data-home-review]' }),
    },
  },
  { width: 1056, height: 720, padded: false },
)
