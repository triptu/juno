import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
import { ActiveThreads } from './ActiveThreads'
import { details, engThreads } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { TopicHeader, type TopicHeaderProps } from './TopicHeader'

const noop = () => {}

const base: Pick<TopicHeaderProps, 'onMenu' | 'onPill' | 'onResolve' | 'juno'> = { onMenu: noop, onPill: noop, onResolve: noop, juno: { open: false, onToggle: noop } }

const state = (props: Partial<TopicHeaderProps> & Pick<TopicHeaderProps, 'detail'>, frame?: FixtureFrame) => fixture<TopicHeaderProps>({ ...base, ...props }, frame)

const threads = <ActiveThreads threads={engThreads} now={NOW} onOpen={noop} />

// The header lies over the top of its area; the frame is that area's top, the band's height.
const narrow: FixtureFrame = { width: 336, height: 68 }

export default defineFixtures(
  TopicHeader,
  {
    Thread: {
      public: state({ detail: details.postgres }),
      private: state({ detail: details.hiring }),
      'direct-message': state({ detail: details.offsite }),
      resolved: state({ detail: { ...details.postgres, resolved: true, status: 'resolved' } }),
    },
    Main: {
      'channel-main': state({ detail: details.engMain, onThreads: noop }),
      'threads-open': state({ detail: details.engMain, onThreads: noop, threadsOpen: true, threads }, { height: 520 }),
      'group-dm-main': state({ detail: details.lunch, onThreads: noop }),
    },
    // Rename from the title menu: the title is a field in place, preselected, as wide as its text.
    Rename: {
      rename: state({ detail: details.postgres, rename: { onSave: noop, onCancel: noop } }),
      'rename-long': state({ detail: details.long, rename: { onSave: noop, onCancel: noop } }),
      'rename-336': state({ detail: details.hiring, rename: { onSave: noop, onCancel: noop } }, narrow),
    },
    // Resolve becomes Reopen once the topic is resolved. The app has no Juno button until the panel exists.
    Resolve: {
      'resolved-no-juno': fixture<TopicHeaderProps>({ detail: { ...details.postgres, resolved: true, status: 'resolved' }, onMenu: noop, onPill: noop, onResolve: noop }),
      'resolved-336': state({ detail: { ...details.hiring, resolved: true, status: 'resolved' } }, narrow),
    },
    // The title's menu is native; the title button shows it is open.
    Menu: {
      'menu-open': state({ detail: details.postgres, menuOpen: true }),
      'juno-open': state({ detail: details.postgres, juno: { open: true, onToggle: noop } }),
      'ai-assist-off': fixture<TopicHeaderProps>({ detail: details.postgres, onMenu: noop, onPill: noop, onResolve: noop }),
    },
    Content: {
      'long-title': state({ detail: details.long }),
      'right-to-left': state({ detail: details.mohammed }),
      'emoji-title': state({ detail: details.unicorn }),
      wide: state({ detail: details.engMain, onThreads: noop }, { width: 1600, height: 68 }),
    },
    // The workspace at the minimum window size (720 by 480) is 336px wide: Resolve is an icon, Threads its count.
    Narrow: {
      'thread-336': state({ detail: details.hiring }, narrow),
      'long-336': state({ detail: details.long }, narrow),
      'direct-message-336': state({ detail: details.offsite }, narrow),
      'main-336': state({ detail: details.engMain, onThreads: noop }, narrow),
      'threads-open-336': state({ detail: details.engMain, onThreads: noop, threadsOpen: true, threads }, { width: 336, height: 520 }),
      // Just above the switch: the full labels.
      'thread-480': state({ detail: details.hiring }, { width: 480, height: 68 }),
    },
    Interaction: {
      'hover-title': state({ detail: details.postgres }, { hover: 'button[aria-haspopup="menu"]' }),
      'hover-threads': state({ detail: details.engMain, onThreads: noop }, { hover: '[data-island="right"] button' }),
      'focus-pill': state({ detail: details.hiring }, { focus: '[data-island="left"] button' }),
    },
  },
  { width: 816, height: 68, padded: false },
)
