import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { newThreadsById, NOW, rows } from './fixtures/topics'
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

// The frame shrinks to its content, so a row would grow to its longest line.
// In the sidebar a row is as wide as the list; this column gives it that width.
const column = { display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'stretch' } as const

/** One row at the width the sidebar gives it, so long text truncates as it does in the app. */
const state = (row: TopicRowProps['row'], extra: Partial<TopicRowProps> = {}, frame?: FixtureFrame) =>
  scene<TopicRowProps>(
    () => (
      <div style={column}>
        <TopicRow {...one(row, extra)} />
      </div>
    ),
    frame,
  )

const ROW = '[data-topic-row]'

export default defineFixtures(
  TopicRow,
  {
    State: {
      read: state(rows.postgres),
      unread: state(rows.roadmap),
      mention: state(rows.hiring),
      selected: state(rows.postgres, { selected: true }),
      'selected-unread': state(rows.roadmap, { selected: true }),
    },
    Kind: {
      main: state(rows.alertsMain),
      'main-new-threads': state(rows.alertsMain, { newThreads: newThreadsById.get(rows.alertsMain.id) }),
      'main-one-new-thread': state(rows.lunch, { newThreads: 1 }),
      'main-new-threads-selected': state(rows.alertsMain, { newThreads: newThreadsById.get(rows.alertsMain.id), selected: true }),
      reopened: state(rows.pricing),
      'pinned-resolved': state(rows.notes),
      'pinned-resolved-selected': state(rows.notes, { selected: true }),
      unsubscribed: state(rows.flags),
      private: state(rows.hiring),
      'group-dm-main': state(rows.lunch),
    },
    Content: {
      'long-title': state(rows.long),
      'long-private-channel': state(rows.vendors),
      'right-to-left': state(rows.rtl),
      'mixed-direction': state(rows.mixed),
      'emoji-names': state(rows.emoji),
      'emoji-group': state(rows.emojiGroup),
      'no-photo': state(rows.packet),
      'no-text': state(rows.file),
      'count-99-plus': state(rows.alertsMain),
      'count-lower-bound': state(rows.lowerBound, { newThreads: newThreadsById.get(rows.lowerBound.id) }),
    },
    Interaction: {
      hover: state(rows.postgres, {}, { hover: ROW }),
      'hover-resolve': state(rows.postgres, {}, { hover: 'button' }),
      focus: state(rows.postgres, {}, { focus: ROW }),
      'focus-resolve': state(rows.postgres, {}, { focus: 'button' }),
      press: state(rows.postgres, {}, { press: ROW }),
      'hover-resolved': state(rows.notes, {}, { hover: ROW }),
    },
    Overview: {
      'all-states': scene(() => (
        <div style={column}>
          {[rows.alertsMain, rows.postgres, rows.hiring, rows.roadmap, rows.pricing, rows.notes, rows.flags].map((row) => (
            <TopicRow key={row.id} {...one(row, { newThreads: newThreadsById.get(row.id) })} />
          ))}
        </div>
      )),
    },
  },
  { width: 384, surface: 'subtle' },
)
