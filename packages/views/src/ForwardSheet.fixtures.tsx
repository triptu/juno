import { defineFixtures, fixture, hueForId, type FixtureFrame } from '@juno/ui'
import { ForwardSheet, type ForwardSheetProps } from './ForwardSheet'
import { message, p, t } from './fixtures/messages'
import { conversations, recentConversations } from './fixtures/newChat'
import { NOW, people } from './fixtures/topics'

const noop = () => {}

const short = message({ ago: 42, from: people.maya, text: 'The rollback test passed on the replica. Numbers are in the doc.' })
const long = message({
  ago: 180,
  from: people.leo,
  blocks: [
    p('Postgres 16 migration plan, round two:'),
    p(t('1. ', { bold: true }), 'Freeze schema changes on Monday and take a full snapshot of the primary before anything else moves.'),
    p(t('2. ', { bold: true }), 'Run the upgrade on the replica first, then compare query plans for the twenty slowest statements in the billing service.'),
    p(t('3. ', { bold: true }), 'If the plans hold, fail over during the Wednesday window and keep the old primary around for a week.'),
    p(t('4. ', { bold: true }), 'Write down every flag we changed, so the next upgrade does not start from scratch.'),
    p('Questions in the thread, please.'),
  ],
})

const sheet = (props: Partial<ForwardSheetProps>, frame?: FixtureFrame) =>
  fixture<ForwardSheetProps>(
    {
      message: short.message,
      sender: short.sender,
      place: '#eng',
      now: NOW,
      hueOf: hueForId,
      destination: undefined,
      pickerOpen: false,
      onPickerOpen: noop,
      query: '',
      onQuery: noop,
      conversations: recentConversations,
      onPick: noop,
      note: '',
      onNote: noop,
      onForward: noop,
      onCancel: noop,
      ...props,
    },
    frame,
  )

export default defineFixtures(
  ForwardSheet,
  {
    Sheet: {
      'nothing-picked': sheet({}),
      // Tall enough for the open destination list under the chip.
      picking: sheet({ pickerOpen: true }, { width: 640, height: 480, padded: true, surface: 'subtle' }),
      'with-note': sheet({ destination: conversations.billing, note: 'FYI for the release notes' }),
      // A note longer than a line wraps, and the field grows with it.
      'long-note': sheet({
        destination: conversations.billing,
        note: 'FYI for the release notes. Leo checked the replica numbers twice, so this is the version to quote. If anything looks off, ask in the thread before Friday, since the window closes then and we will not get another one this month.',
      }),
      // In a DM with its sender the place is the sender's name, so it shows once.
      'from-a-dm': sheet({ place: people.maya.name }),
      'to-a-person': sheet({ destination: conversations.sam }),
      'long-message': sheet({ message: long.message, sender: long.sender, place: 'Postgres 16 migration plan', destination: conversations.long }),
      forwarding: sheet({ destination: conversations.billing, note: 'FYI', busy: true }),
    },
  },
  { width: 640, padded: true, surface: 'subtle' },
)
