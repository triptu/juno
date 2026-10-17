import { useState } from 'react'
import type { HomeTopic } from '@juno/contract'
import { defineFixtures, scene } from '@juno/ui'
import { homeItems } from './fixtures/home'
import { doneFollowUpsItem, doneFollowUpTopics, oldDraftsItem, oldDraftTopics } from './fixtures/reviews'
import { OverHome } from './fixtures/OverHome'
import { NOW } from './fixtures/topics'
import { Home } from './Home'
import type { ReviewStatus } from './reviewModel'
import { DoneFollowUpsReview, OldDraftsReview, type CardReviewProps } from './ReviewCards'

const noop = () => {}

type Card = 'followUps' | 'drafts'

/** A card's review with its buttons working, so the gallery and the shift guard see a row change state in place. */
function Live({ card, topics, initial = new Map(), ...rest }: Partial<CardReviewProps> & { readonly card: Card; readonly initial?: ReadonlyMap<string, ReviewStatus> }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ReviewStatus>>(initial)
  const set = (id: string, status: ReviewStatus) => setStatuses(new Map([...statuses, [id, status]]))
  const props: CardReviewProps = {
    topics: topics ?? (card === 'followUps' ? doneFollowUpTopics : oldDraftTopics),
    statuses,
    now: NOW,
    onOpen: noop,
    onAct: (id) => set(id, 'done'),
    onDecline: (id) => set(id, 'declined'),
    onUndo: (id) => set(id, 'open'),
    onSettings: noop,
    onClose: noop,
    ...rest,
  }
  return card === 'followUps' ? <DoneFollowUpsReview {...props} /> : <OldDraftsReview {...props} />
}

const cards = [homeItems.waiting, doneFollowUpsItem, oldDraftsItem]

const acted = (topics: ReadonlyArray<HomeTopic>): ReadonlyMap<string, ReviewStatus> =>
  new Map([
    [topics[0]!.id, 'done'],
    [topics[2]!.id, 'declined'],
  ])

function CardsOnHome() {
  return <Home scene="evening" title="Evening, Tushar." items={cards} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />
}

export default defineFixtures(
  DoneFollowUpsReview,
  {
    // Card 4: a promise, why it looks done, and the matching message quoted.
    'Follow-ups that look done': {
      'over-home': scene(() => <OverHome items={cards}><Live card="followUps" /></OverHome>),
      about: scene(() => <OverHome items={cards}><Live card="followUps" initialAbout /></OverHome>),
      acted: scene(() => <OverHome items={cards}><Live card="followUps" initial={acted(doneFollowUpTopics)} /></OverHome>),
      one: scene(() => <OverHome items={cards}><Live card="followUps" topics={doneFollowUpTopics.slice(0, 1)} /></OverHome>),
      'minimum-window': scene(() => <OverHome items={cards}><Live card="followUps" /></OverHome>, { width: 336, height: 436, padded: false }),
    },
    // Card 5: the topic, the draft's age and how far the topic moved, and its first line.
    'Old drafts': {
      'over-home': scene(() => <OverHome items={cards}><Live card="drafts" /></OverHome>),
      about: scene(() => <OverHome items={cards}><Live card="drafts" initialAbout /></OverHome>),
      acted: scene(() => <OverHome items={cards}><Live card="drafts" initial={acted(oldDraftTopics)} /></OverHome>),
      'minimum-window': scene(() => <OverHome items={cards}><Live card="drafts" /></OverHome>, { width: 336, height: 436, padded: false }),
    },
    // Home's cards: the whole row opens the review; the meta line names the places.
    Cards: {
      cards: scene(() => <CardsOnHome />),
      'card-focus': scene(() => <CardsOnHome />, { focus: '[data-home-item="oldDrafts"] [data-home-review]' }),
    },
  },
  { width: 1056, height: 720, padded: false },
)
