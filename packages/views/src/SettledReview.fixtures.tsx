import { useState, type ReactNode } from 'react'
import { defineFixtures, scene } from '@juno/ui'
import { homeItems } from './fixtures/home'
import { manySettled, settledTopics, tidyUpItem } from './fixtures/settled'
import { OverHome as SheetOverHome } from './fixtures/sheetFrame'
import { NOW } from './fixtures/topics'
import { Home } from './Home'
import type { ReviewStatus } from './reviewModel'
import { SettledReview, type SettledReviewProps } from './SettledReview'

const noop = () => {}

/** The review with its buttons working, so the gallery and the shift guard see a row change state in place. */
function Live({ topics = settledTopics, initial = new Map(), ...rest }: Partial<SettledReviewProps> & { readonly initial?: ReadonlyMap<string, ReviewStatus> }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ReviewStatus>>(initial)
  const set = (id: string, status: ReviewStatus) => setStatuses(new Map([...statuses, [id, status]]))
  return (
    <SettledReview
      topics={topics}
      statuses={statuses}
      now={NOW}
      onOpen={noop}
      onAct={(id) => set(id, 'done')}
      onDecline={(id) => set(id, 'declined')}
      onUndo={(id) => set(id, 'open')}
      onAll={() => setStatuses(new Map(topics.map((topic) => [topic.id, statuses.get(topic.id) ?? 'done'])))}
      onSettings={noop}
      onClose={noop}
      {...rest}
    />
  )
}

/** Home under the sheet's layer, as the window shows it: the layer dims the page and the sheet sits in the middle. */
function OverHome({ children }: { readonly children: ReactNode }) {
  return <SheetOverHome home={<Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, homeItems.followUp, tidyUpItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />}>{children}</SheetOverHome>
}

const acted: ReadonlyMap<string, ReviewStatus> = new Map([
  [settledTopics[0]!.id, 'done'],
  [settledTopics[3]!.id, 'declined'],
])

export default defineFixtures(
  SettledReview,
  {
    // Direction A, built: a sheet over Home.
    'A · Sheet': {
      'over-home': scene(() => <OverHome><Live /></OverHome>),
      about: scene(() => <OverHome><Live initialAbout /></OverHome>),
      // Two acted on: each row stays where it was and says what happened, with Undo.
      acted: scene(() => <OverHome><Live initial={acted} /></OverHome>),
      'focus-row': scene(() => <OverHome><Live initialActive={settledTopics[1]!.id} /></OverHome>, { focus: `[data-review-row="${settledTopics[1]!.id}"] a` }),
      many: scene(() => <OverHome><Live topics={manySettled} /></OverHome>),
      'all-done': scene(() => <OverHome><Live initial={new Map(settledTopics.map((topic) => [topic.id, 'done' as const]))} /></OverHome>),
      'minimum-window': scene(() => <OverHome><Live /></OverHome>, { width: 336, height: 436, padded: false }),
    },
    // Home's card: the whole row opens the review; Resolve all stays in its slot.
    Card: {
      card: scene(() => <Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, homeItems.followUp, tidyUpItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />, { hover: '[data-home-review]' }),
      'card-focus': scene(() => <Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, homeItems.followUp, tidyUpItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />, { focus: '[data-home-review]' }),
    },
  },
  { width: 1056, height: 720, padded: false },
)

