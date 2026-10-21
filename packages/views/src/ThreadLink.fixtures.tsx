import { defineFixtures, fixture } from '@juno/ui'
import { ThreadLink, type ThreadLinkProps } from './ThreadLink'

const noop = () => {}

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
    Interaction: {
      hover: link(2, '2 replies', 'Maya: Sounds good.', { hover: '[role="button"]' }),
      focus: link(2, '2 replies', 'Maya: Sounds good.', { focus: '[role="button"]' }),
      press: link(2, '2 replies', 'Maya: Sounds good.', { press: '[role="button"]' }),
    },
  },
  { width: 420 },
)
