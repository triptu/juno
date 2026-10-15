import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
import { details, engTopics } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { TopicHeader, type TopicHeaderProps } from './TopicHeader'
import { TopicSwitcher } from './TopicSwitcher'

const noop = () => {}

const base: Pick<TopicHeaderProps, 'onMenu' | 'onPill' | 'onResolve' | 'juno'> = { onMenu: noop, onPill: noop, onResolve: noop, juno: { open: false, onToggle: noop } }

const state = (props: Partial<TopicHeaderProps> & Pick<TopicHeaderProps, 'detail'>, frame?: FixtureFrame) => fixture<TopicHeaderProps>({ ...base, ...props }, frame)

/** The title's switcher, open, on a thread of #eng or on its Main. */
const switcher = (currentId: string, query = '') => ({
  open: true,
  onOpen: noop,
  content: <TopicSwitcher mainId="C0ENG:main" mainUnread={3} currentId={currentId} threads={engTopics} now={NOW} query={query} onQuery={noop} onOpen={noop} />,
})

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
      'channel-main': state({ detail: details.engMain }),
      'group-dm-main': state({ detail: details.lunch }),
    },
    // The title opens the switcher under the left island: the channel's Main and threads, the resolved ones last.
    Switcher: {
      'switcher-thread': state({ detail: details.postgres, switcher: switcher(details.postgres.id) }, { height: 560 }),
      'switcher-main': state({ detail: details.engMain, switcher: switcher('C0ENG:main') }, { height: 560 }),
      'switcher-search': state({ detail: details.postgres, switcher: switcher(details.postgres.id, 'staging') }, { height: 300 }),
      'switcher-336': state({ detail: details.hiring, switcher: switcher(details.hiring.id) }, { width: 336, height: 560 }),
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
    // The topic menu is native; ⋯ shows it is open, from ⋯ or a right-click on the title.
    Menu: {
      'menu-open': state({ detail: details.postgres, menuOpen: true }),
      'juno-open': state({ detail: details.postgres, juno: { open: true, onToggle: noop } }),
      'ai-assist-off': fixture<TopicHeaderProps>({ detail: details.postgres, onMenu: noop, onPill: noop, onResolve: noop }),
    },
    Content: {
      'long-title': state({ detail: details.long }),
      'right-to-left': state({ detail: details.mohammed }),
      'emoji-title': state({ detail: details.unicorn }),
      wide: state({ detail: details.engMain }, { width: 1600, height: 68 }),
    },
    // The workspace at the minimum window size (720 by 480) is 336px wide: Resolve is an icon, Threads its count.
    Narrow: {
      'thread-336': state({ detail: details.hiring }, narrow),
      'long-336': state({ detail: details.long }, narrow),
      'direct-message-336': state({ detail: details.offsite }, narrow),
      'main-336': state({ detail: details.engMain }, narrow),
      // Just above the switch: the full labels.
      'thread-480': state({ detail: details.hiring }, { width: 480, height: 68 }),
    },
    // Every control in the islands has the same hover, keyboard focus and press.
    Interaction: {
      'hover-title': state({ detail: details.postgres }, { hover: 'button[aria-haspopup="menu"]' }),
      'hover-more': state({ detail: details.postgres }, { hover: 'button[aria-label="More"]' }),
      'press-more': state({ detail: details.postgres }, { press: 'button[aria-label="More"]' }),
      'focus-more': state({ detail: details.postgres }, { focus: 'button[aria-label="More"]' }),
      'menu-open-main': state({ detail: details.engMain, menuOpen: true }),
      'hover-resolve': state({ detail: details.postgres }, { hover: 'button[aria-label="Resolve"]' }),
      'hover-reopen': state({ detail: { ...details.postgres, resolved: true, status: 'resolved' } }, { hover: 'button[aria-label="Reopen"]' }),
      'hover-resolve-336': state({ detail: details.hiring }, { ...narrow, hover: 'button[aria-label="Resolve"]' }),
      'hover-juno': state({ detail: details.postgres }, { hover: 'button[aria-label="Juno ⌘J"]' }),
      'hover-pill': state({ detail: details.postgres }, { hover: '[data-island="left"] button' }),
      'press-resolve': state({ detail: details.postgres }, { press: 'button[aria-label="Resolve"]' }),
      'press-title': state({ detail: details.postgres }, { press: 'button[aria-haspopup="menu"]' }),
      'focus-pill': state({ detail: details.hiring }, { focus: '[data-island="left"] button' }),
      'focus-title': state({ detail: details.postgres }, { focus: 'button[aria-haspopup="menu"]' }),
      'focus-resolve': state({ detail: details.postgres }, { focus: 'button[aria-label="Resolve"]' }),
      'focus-juno': state({ detail: details.postgres }, { focus: 'button[aria-label="Juno ⌘J"]' }),
    },
  },
  { width: 816, height: 68, padded: false },
)
