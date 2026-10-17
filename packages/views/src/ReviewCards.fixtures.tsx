import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import type { HomeTopic } from '@juno/contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, scene } from '@juno/ui'
import { homeItems } from './fixtures/home'
import { doneFollowUpsItem, doneFollowUpTopics, oldDraftsItem, oldDraftTopics } from './fixtures/reviews'
import { NOW } from './fixtures/topics'
import { Home } from './Home'
import type { ReviewStatus } from './Review'
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

/** Home under the sheet's layer, as the window shows it. */
function OverHome({ children }: { readonly children: ReactNode }) {
  return (
    <div {...stylex.props(styles.window)}>
      <Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, doneFollowUpsItem, oldDraftsItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />
      <div {...stylex.props(styles.layer)}>{children}</div>
    </div>
  )
}

const acted = (topics: ReadonlyArray<HomeTopic>): ReadonlyMap<string, ReviewStatus> =>
  new Map([
    [topics[0]!.id, 'done'],
    [topics[2]!.id, 'declined'],
  ])

function CardsOnHome() {
  return <Home scene="evening" title="Evening, Tushar." items={[homeItems.waiting, doneFollowUpsItem, oldDraftsItem]} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />
}

export default defineFixtures(
  DoneFollowUpsReview,
  {
    // Card 4: a promise, why it looks done, and the matching message quoted.
    'Follow-ups that look done': {
      'over-home': scene(() => <OverHome><Live card="followUps" /></OverHome>),
      about: scene(() => <OverHome><Live card="followUps" initialAbout /></OverHome>),
      acted: scene(() => <OverHome><Live card="followUps" initial={acted(doneFollowUpTopics)} /></OverHome>),
      one: scene(() => <OverHome><Live card="followUps" topics={doneFollowUpTopics.slice(0, 1)} /></OverHome>),
      'minimum-window': scene(() => <OverHome><Live card="followUps" /></OverHome>, { width: 336, height: 436, padded: false }),
    },
    // Card 5: the topic, the draft's age and how far the topic moved, and its first line.
    'Old drafts': {
      'over-home': scene(() => <OverHome><Live card="drafts" /></OverHome>),
      about: scene(() => <OverHome><Live card="drafts" initialAbout /></OverHome>),
      acted: scene(() => <OverHome><Live card="drafts" initial={acted(oldDraftTopics)} /></OverHome>),
      'minimum-window': scene(() => <OverHome><Live card="drafts" /></OverHome>, { width: 336, height: 436, padded: false }),
    },
    // Home's cards: the whole row opens the review; the meta line names the places.
    Cards: {
      cards: scene(() => <CardsOnHome />),
      'card-focus': scene(() => <CardsOnHome />, { focus: '[data-home-item="oldDrafts"] [data-home-review]' }),
    },
  },
  { width: 1056, height: 720, padded: false },
)

const styles = stylex.create({
  // The frame's size: its first child fills it.
  window: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '720px', // tokens-allow: the fixture frame's height
    overflow: 'hidden',
    backgroundColor: colors['--background'],
  },
  // The `SheetLayer` look, inside the frame instead of the whole window.
  layer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['--space-6'],
    backgroundColor: colors['--overlay'],
  },
})
