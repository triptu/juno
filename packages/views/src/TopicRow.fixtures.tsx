import { defineFixtures, fixture, scene } from '@juno/ui'
import { NOW, rows } from './fixtures/topics'
import { relativeTime } from './time'
import { TopicRow, type TopicRowProps } from './TopicRow'

const noop = () => {}

const one = (row: TopicRowProps['row'], extra: Partial<TopicRowProps> = {}): TopicRowProps => ({
  row,
  time: relativeTime(row.lastActivityAt, NOW),
  onOpen: noop,
  onResolve: noop,
  ...extra,
})

const ROW = '[data-topic-row]'

export default defineFixtures(
  TopicRow,
  {
    State: {
      read: fixture(one(rows.postgres)),
      unread: fixture(one(rows.roadmap)),
      mention: fixture(one(rows.hiring)),
      selected: fixture(one(rows.postgres, { selected: true })),
      'selected-unread': fixture(one(rows.roadmap, { selected: true })),
    },
    Kind: {
      main: fixture(one(rows.alertsMain)),
      reopened: fixture(one(rows.pricing)),
      'pinned-resolved': fixture(one(rows.notes)),
      unsubscribed: fixture(one(rows.flags)),
      'group-dm-main': fixture(one(rows.lunch)),
    },
    Content: {
      'long-title': fixture(one(rows.long)),
      'no-photo': fixture(one(rows.packet)),
      'no-text': fixture(one(rows.file)),
      'count-99-plus': fixture(one(rows.alertsMain)),
    },
    Interaction: {
      hover: fixture(one(rows.postgres), { hover: ROW }),
      'hover-resolve': fixture(one(rows.postgres), { hover: 'button' }),
      focus: fixture(one(rows.postgres), { focus: ROW }),
      'focus-resolve': fixture(one(rows.postgres), { focus: 'button' }),
      press: fixture(one(rows.postgres), { press: ROW }),
      'hover-resolved': fixture(one(rows.notes), { hover: ROW }),
    },
    Overview: {
      'all-states': scene(() => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 368 }}>
          {[rows.alertsMain, rows.postgres, rows.hiring, rows.roadmap, rows.pricing, rows.notes, rows.flags].map((row) => (
            <TopicRow key={row.id} {...one(row)} />
          ))}
        </div>
      )),
    },
  },
  { width: 384, surface: 'subtle' },
)
