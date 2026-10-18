import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { art, channels, newThreadsById, NOW, people, rows } from './fixtures/topics'
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

const titleColumn = (lines: '1' | '2') => ({ ...column, '--topic-title-lines': lines, '--topic-title-white-space': lines === '2' ? 'normal' : 'nowrap' })

const titleScene = (lines: '1' | '2', density: 'compact' | 'comfortable') => scene<TopicRowProps>(() => (
  <div style={titleColumn(lines)}>
    <TopicRow {...one({ ...rows.postgres, title: 'Plan' })} />
    <TopicRow {...one({ ...rows.postgres, id: 'fits', title: 'Plan the next release together this week' })} />
    <TopicRow {...one(rows.long)} />
    <TopicRow {...one(rows.mayaMain)} />
  </div>
), { density })

const ROW = '[data-topic-row]'

/** A DM's Main whose latest message is yours: the preview keeps "You:". */
const devMain: TopicRowProps['row'] = { ...rows.mayaMain, id: 'm:D0DEV', title: 'Dev Patel', channel: channels.dev, preview: { sender: 'You', text: 'its good' } }

/** Unread people, a Reopened tag and a channel name too long for the meta line: the preview and the name give way, the stack shows whole. */
const vendorsPeople: TopicRowProps['row'] = {
  ...rows.vendors,
  id: 'C0VENDORS:1759990000.001500',
  title: 'Renewal terms for the analytics vendor',
  preview: { sender: 'Sam', text: 'They came back at 12% over last year. Pushing for flat.' },
  participants: [people.sam, people.elena, people.maya],
  unreadCount: 2,
  tags: ['reopened'],
  art: art.coins,
}

export default defineFixtures(
  TopicRow,
  {
    State: {
      read: state(rows.postgres),
      unread: state(rows.roadmap),
      // Comfortable density: the 44px tile and more padding.
      'unread-comfortable': state(rows.roadmap, {}, { density: 'comfortable' }),
      mention: state(rows.hiring),
      selected: state(rows.postgres, { selected: true }),
      'selected-unread': state(rows.roadmap, { selected: true }),
      // Rename from the row's menu: the title is a field, preselected; no Resolve.
      renaming: state(rows.postgres, { renaming: true, onRename: noop, onRenameCancel: noop }),
      'renaming-selected': state(rows.roadmap, { renaming: true, selected: true, onRename: noop, onRenameCancel: noop }),
    },
    Titles: {
      'one-line-compact': titleScene('1', 'compact'),
      'two-lines-compact': titleScene('2', 'compact'),
      'one-line-comfortable': titleScene('1', 'comfortable'),
      'two-lines-comfortable': titleScene('2', 'comfortable'),
    },
    Tile: {
      art: state(rows.postgres),
      placeholder: state({ ...rows.postgres, art: undefined }),
      'dm-thread-art': state(rows.offsite),
      'dm-main-photo': state(rows.mayaMain),
      'dm-main-yours': state(devMain),
      'main-art': state(rows.alertsMain),
      'main-placeholder': state({ ...rows.alertsMain, art: undefined }),
      'placeholder-quiet': state(rows.notes),
      'art-quiet': state({ ...rows.flags, art: art.coins }),
      // Five drawings in five hues, then four pebbles, against the row's text:
      // the shot to judge the art's weight in light and in dark.
      'art-and-pebbles': scene(() => (
        <div style={column}>
          {[
            rows.postgres,
            rows.hiring,
            rows.alertsMain,
            rows.offsite,
            { ...rows.flags, art: art.coins },
            { ...rows.roadmap, art: undefined },
            { ...rows.pricing, art: undefined },
            { ...rows.packet, art: undefined },
            { ...rows.long, art: undefined },
          ].map((row) => (
            <TopicRow key={row.id} {...one(row)} />
          ))}
        </div>
      )),
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
    // The count ends on the time's right edge, whatever its width.
    Count: {
      '3': state(rows.roadmap),
      '12': state({ ...rows.roadmap, unreadCount: 12 }),
      '99-plus': state({ ...rows.roadmap, unreadCount: 128 }),
      'all-widths': scene(() => (
        <div style={column}>
          {[3, 12, 128].flatMap((unreadCount) => [
            <TopicRow key={`thread-${unreadCount}`} {...one({ ...rows.roadmap, id: `${rows.roadmap.id}-${unreadCount}`, unreadCount })} />,
            <TopicRow key={`main-${unreadCount}`} {...one({ ...rows.alertsMain, id: `${rows.alertsMain.id}-${unreadCount}`, unreadCount })} />,
          ])}
        </div>
      )),
    },
    Interaction: {
      hover: state(rows.postgres, {}, { hover: ROW }),
      'hover-resolve': state(rows.postgres, {}, { hover: 'button' }),
      focus: state(rows.postgres, {}, { focus: ROW }),
      'focus-resolve': state(rows.postgres, {}, { focus: 'button' }),
      press: state(rows.postgres, {}, { press: ROW }),
      'hover-resolved': state(rows.notes, {}, { hover: ROW }),
    },
    // The three text levels across every kind of row, read and unread, with
    // one selected and one past four people: the shot for contrast in light,
    // dark and each accent, and the rows the gallery contrast test measures.
    Hierarchy: {
      'mixed-list': scene(() => (
        <div style={column}>
          {[rows.alertsMain, rows.postgres, rows.lowerBound, rows.hiring, rows.vendors, rows.mayaMain, rows.offsite, rows.lunch, rows.roadmap].map((row) => (
            <TopicRow key={row.id} {...one(row, { selected: row === rows.postgres })} />
          ))}
        </div>
      )),
      'mixed-list-hover': scene(
        () => (
          <div style={column}>
            {[rows.postgres, rows.roadmap, rows.hiring].map((row) => (
              <TopicRow key={row.id} {...one(row)} />
            ))}
          </div>
        ),
        { hover: `${ROW}:nth-of-type(2)` },
      ),
    },
    // The two row heights side by side: a DM's Main and a group DM's Main in
    // two lines, a DM thread and channel rows in three, with the people
    // beside the count on the preview line.
    Sidebar: {
      'mixed-rows': scene(() => (
        <div style={column}>
          {[rows.mayaMain, devMain, rows.lunch, rows.offsite, rows.lowerBound, vendorsPeople, rows.roadmap].map((row) => (
            <TopicRow key={row.id} {...one(row, { newThreads: newThreadsById.get(row.id) })} />
          ))}
        </div>
      )),
      'mixed-rows-hover': scene(
        () => (
          <div style={column}>
            {[rows.mayaMain, rows.lowerBound, vendorsPeople].map((row) => (
              <TopicRow key={row.id} {...one(row)} />
            ))}
          </div>
        ),
        { hover: ROW },
      ),
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
