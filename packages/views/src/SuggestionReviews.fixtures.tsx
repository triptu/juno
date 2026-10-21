import { useState } from 'react'
import type { HomeTopic } from '@juno/contract'
import { defineFixtures, scene } from '@juno/ui'
import { homeItems } from './fixtures/home'
import { OverHome } from './fixtures/sheetFrame'
import { ignoreItem, ignoreTopics, mentionedItem, unfollowItem, unfollowTopics } from './fixtures/suggestions'
import { NOW } from './fixtures/topics'
import { Home } from './Home'
import type { CardReviewProps } from './ReviewCards'
import type { ReviewStatus } from './reviewModel'
import { IgnoreReview, UnfollowReview } from './SuggestionReviews'

const noop = () => {}

const home = (items: Parameters<typeof Home>[0]['items']) => (
  <Home scene="evening" title="Evening, Tushar." items={items} now={NOW} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />
)

/** Unfollow's or Ignore's review over Home, its buttons working, so the gallery and the shift guard see a row change in place. */
function Sheet({ card, topics, initial = new Map(), ...rest }: Partial<CardReviewProps> & { readonly card: 'unfollow' | 'ignore'; readonly initial?: ReadonlyMap<string, ReviewStatus> }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ReviewStatus>>(initial)
  const mark = (status: ReviewStatus) => (id: string) => setStatuses(new Map([...statuses, [id, status]]))
  const props: CardReviewProps = { topics: topics ?? (card === 'unfollow' ? unfollowTopics : ignoreTopics), statuses, now: NOW, onOpen: noop, onAct: mark('done'), onDecline: mark('declined'), onUndo: mark('open'), onSettings: noop, onClose: noop, ...rest }
  return <OverHome home={home([homeItems.waiting, unfollowItem, ignoreItem])}>{card === 'unfollow' ? <UnfollowReview {...props} /> : <IgnoreReview {...props} />}</OverHome>
}

/** One row acted on and one said no to: each stays in place with Undo. */
const answered = (topics: ReadonlyArray<HomeTopic>): ReadonlyMap<string, ReviewStatus> => new Map([[topics[0]!.id, 'done'], [topics[1]!.id, 'declined']])

export default defineFixtures(
  UnfollowReview,
  {
    // Card 1: Unfollow writes to Slack, and the lead says so.
    Unfollow: {
      'over-home': scene(() => <Sheet card="unfollow" />),
      about: scene(() => <Sheet card="unfollow" initialAbout />),
      acted: scene(() => <Sheet card="unfollow" initial={answered(unfollowTopics)} />),
      'minimum-window': scene(() => <Sheet card="unfollow" />, { width: 336, height: 436, padded: false }),
    },
    // Card 6: Ignore is only in Juno, and a mention of you still breaks through.
    Ignore: {
      'over-home': scene(() => <Sheet card="ignore" />),
      about: scene(() => <Sheet card="ignore" initialAbout />),
      acted: scene(() => <Sheet card="ignore" initial={answered(ignoreTopics)} />),
      'minimum-window': scene(() => <Sheet card="ignore" />, { width: 336, height: 436, padded: false }),
    },
    // Home: a mention in an ignored channel opens the topic; the two cards open their review.
    Cards: {
      cards: scene(() => home([mentionedItem, unfollowItem, ignoreItem])),
      'card-focus': scene(() => home([mentionedItem, unfollowItem, ignoreItem]), { focus: '[data-home-item="unfollow"] [data-home-review]' }),
    },
  },
  { width: 1056, height: 720, padded: false },
)
