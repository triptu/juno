import { defineFixtures, fixture } from '@juno/ui'
import { ThreadLink, type ThreadLinkProps } from './ThreadLink'

const noop = () => {}

const link = (replyCount: number, label: string, title: string, frame?: Parameters<typeof fixture>[1]) =>
  fixture<ThreadLinkProps>({ link: { id: 'C0ENG:1759993200.000100', replyCount, label, title, titleSource: 'ai' }, onOpen: noop }, frame)

export default defineFixtures(
  ThreadLink,
  {
    Label: {
      replies: link(2, '2 replies', 'Staging bill doubled since August'),
      'one-reply': link(1, '1 reply', 'Anyone else seeing slow CI on the main branch?'),
      'thread-only': link(0, 'Thread', 'Office is closed Friday for the floor refit.'),
      'long-title': link(23, '23 replies', 'Rotate the staging secrets before the audit, and document where each one lives so nobody has to ask again'),
      'right-to-left': link(3, '3 replies', 'هل يمكننا مراجعة خطة الترحيل غدًا قبل الاجتماع الأسبوعي'),
    },
    Interaction: {
      hover: link(2, '2 replies', 'Staging bill doubled since August', { hover: '[role="button"]' }),
      focus: link(2, '2 replies', 'Staging bill doubled since August', { focus: '[role="button"]' }),
      press: link(2, '2 replies', 'Staging bill doubled since August', { press: '[role="button"]' }),
    },
  },
  { width: 420 },
)
