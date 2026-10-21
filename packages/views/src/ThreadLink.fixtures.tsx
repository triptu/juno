import { defineFixtures, fixture } from '@juno/ui'
import { ThreadLink, type ThreadLinkProps } from './ThreadLink'
import { people } from './fixtures/topics'

const noop = () => {}
const repliers = [people.sam, people.dev, people.maya, people.leo]
const withRepliers = (count: number, photo?: string) => fixture<ThreadLinkProps>({
  link: { id: 'C0ENG:1759993200.000100', replyCount: 5, label: '5 replies', preview: 'Sam: Quarantining it. Ticket filed.', replierIds: repliers.slice(0, Math.min(count, 3)).map((person) => person.id) },
  people: new Map(repliers.map((person) => [person.id, photo === undefined ? person : { ...person, avatarUrl: photo, avatarSmallUrl: photo }])),
  onOpen: noop,
})

const link = (replyCount: number, label: string, preview: string | undefined, frame?: Parameters<typeof fixture>[1]) =>
  fixture<ThreadLinkProps>({ link: { id: 'C0ENG:1759993200.000100', replyCount, label, ...(preview === undefined ? {} : { preview }) }, onOpen: noop }, frame)

export default defineFixtures(
  ThreadLink,
  {
    Label: {
      replies: link(2, '2 replies', 'Maya: Sounds good.'),
      'one-reply': link(1, '1 reply', 'Leo: The runners look busy.'),
      'not-loaded': link(5, '5 replies', undefined),
      'without-sender': link(2, '2 replies', 'Sounds good.'),
      'thread-only': link(0, 'Thread', undefined),
      'long-preview': link(23, '23 replies', 'Priya: Rotate the staging secrets before the audit, and document where each one lives so nobody has to ask again'),
      'right-to-left': link(3, '3 replies', 'هل يمكننا مراجعة خطة الترحيل غدًا قبل الاجتماع الأسبوعي'),
    },
    Repliers: {
      one: withRepliers(1),
      two: withRepliers(2),
      three: withRepliers(3),
      'more-than-three': withRepliers(4),
      empty: fixture<ThreadLinkProps>({ link: { id: 'C0ENG:1759993200.000100', replyCount: 5, label: '5 replies', replierIds: [] }, onOpen: noop }),
      'photo-pending': withRepliers(3, '/__fixture/pending.png'),
      'photo-failed': withRepliers(3, '/__fixture/missing.png'),
    },
    Interaction: {
      hover: link(2, '2 replies', 'Maya: Sounds good.', { hover: '[role="button"]' }),
      focus: link(2, '2 replies', 'Maya: Sounds good.', { focus: '[role="button"]' }),
      press: link(2, '2 replies', 'Maya: Sounds good.', { press: '[role="button"]' }),
    },
  },
  { width: 420 },
)
