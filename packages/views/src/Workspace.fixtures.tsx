import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { ComposerSlot } from './ComposerSlot'
import { details, main, mainDividerBefore, thread } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { MessageList } from './MessageList'
import { TopicHeader } from './TopicHeader'
import { TitlebarNav } from './TitlebarNav'
import { TopicView } from './TopicView'
import { Workspace, type WorkspaceProps, type WorkspaceTab } from './Workspace'

const noop = () => {}

const tabs = {
  eng: { id: 'C0ENG:main', title: 'eng', icon: 'hash' } satisfies WorkspaceTab,
  postgres: { id: 'C0ENG:1760000000.000100', title: 'Postgres 16 migration plan', icon: 'hash' } satisfies WorkspaceTab,
  density: { id: 'C0DESIGNREV:1759900000.000900', title: 'Thread list density', icon: 'hash' } satisfies WorkspaceTab,
  hiring: { id: 'C0HIRING:1760000000.000300', title: 'Rina Sato · Staff backend', icon: 'lock' } satisfies WorkspaceTab,
  maya: { id: 'D0MAYA:1759990000.000500', title: 'Offsite: Wednesday afternoon slot', icon: 'user' } satisfies WorkspaceTab,
  pinnedEng: { id: 'tab-pinned-eng', title: 'eng', icon: 'hash', pinned: true } satisfies WorkspaceTab,
  pinnedMaya: { id: 'tab-pinned-maya', title: 'Offsite: Wednesday afternoon slot', icon: 'user', pinned: true, unread: true } satisfies WorkspaceTab,
  densityUnread: { id: 'tab-density-unread', title: 'Thread list density', icon: 'hash', unread: true } satisfies WorkspaceTab,
  newChat: { id: 'tab-new-chat', title: 'New chat', icon: 'new-chat' } satisfies WorkspaceTab,
  // A New chat with a destination picked keeps its icon and takes the destination's name.
  newChatPicked: { id: 'tab-new-chat', title: 'Postgres 16 cutover window', icon: 'new-chat' } satisfies WorkspaceTab,
  home: { id: 'tab-home', title: 'Home', icon: 'home' } satisfies WorkspaceTab,
} as const

const browserTabs = [tabs.pinnedEng, tabs.pinnedMaya, tabs.postgres, tabs.densityUnread, tabs.hiring]
const sidebarControls = <TitlebarNav sidebarHidden canGoBack canGoForward={false} onToggleSidebar={noop} onBack={noop} onForward={noop} />

/** Thirty-seven topic tabs, the last one active, so the strip has to scroll to show it. */
const thirtySeven: ReadonlyArray<WorkspaceTab> = Array.from({ length: 37 }, (_, index) => {
  const sample = [tabs.postgres, tabs.hiring, tabs.density, tabs.maya][index % 4] ?? tabs.postgres
  return { ...sample, id: `${sample.id}:${index}`, title: `${sample.title} ${index + 1}` }
})
const lastTab = thirtySeven[thirtySeven.length - 1]?.id

const base: Omit<WorkspaceProps, 'children'> = { tabs: [tabs.postgres, tabs.density], activeId: tabs.postgres.id, onSelectTab: noop, onCloseTab: noop, onNewTab: noop, onTabContextMenu: noop }

const postgresPage = (
  <TopicView header={<TopicHeader detail={details.postgres} onRename={noop} />} composer={<ComposerSlot placeholder="Reply" />}>
    <MessageList items={thread} main={false} now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} />
  </TopicView>
)

const engPage = (
  <TopicView header={<TopicHeader detail={details.engMain} onThreads={noop} />} composer={<ComposerSlot placeholder="Message #eng" />}>
    <MessageList items={main} main now={NOW} dividerBefore={mainDividerBefore} onOpenThread={noop} onChannel={noop} onLink={noop} />
  </TopicView>
)

const workspace = (props: Partial<WorkspaceProps> = {}, page?: React.ReactNode, frame?: FixtureFrame) =>
  scene<WorkspaceProps>(
    () => (
      <Workspace {...base} {...props}>
        {page}
      </Workspace>
    ),
    frame,
  )

export default defineFixtures(
  Workspace,
  {
    Page: {
      'nothing-open': workspace({ tabs: [] }),
      'topic-open': workspace({}, postgresPage),
      'main-open': workspace({ tabs: [tabs.eng, tabs.density], activeId: tabs.eng.id }, engPage),
      'many-tabs': workspace({ tabs: [tabs.postgres, tabs.hiring, tabs.eng, tabs.density, tabs.maya], activeId: tabs.eng.id }, engPage),
      'minimum-window': workspace({ tabs: [tabs.postgres, tabs.hiring, tabs.eng, tabs.density, tabs.maya], activeId: tabs.eng.id }, engPage, { width: 720, height: 480 }),
      'pinned-and-unread': workspace({ tabs: browserTabs, activeId: tabs.postgres.id }, postgresPage),
      'pinned-active': workspace({ tabs: browserTabs, activeId: tabs.pinnedEng.id }, engPage),
      'new-chat-tab': workspace({ tabs: [tabs.postgres, tabs.newChat], activeId: tabs.newChat.id }),
      'new-chat-picked': workspace({ tabs: [tabs.postgres, tabs.newChatPicked], activeId: tabs.newChatPicked.id }),
      // Home's content is the empty workspace until the Home page is built.
      'home-tab': workspace({ tabs: [tabs.home, tabs.postgres], activeId: tabs.home.id }),
      'sidebar-hidden': workspace({ tabs: browserTabs, activeId: tabs.postgres.id, leading: sidebarControls }, postgresPage),
      'sidebar-hidden-minimum-window': workspace({ tabs: browserTabs, activeId: tabs.postgres.id, leading: sidebarControls }, postgresPage, { width: 720, height: 480 }),
      'thirty-seven-tabs': workspace({ tabs: thirtySeven, ...(lastTab === undefined ? {} : { activeId: lastTab }) }, postgresPage),
      'thirty-seven-tabs-minimum-window': workspace({ tabs: thirtySeven, ...(lastTab === undefined ? {} : { activeId: lastTab }) }, postgresPage, { width: 720, height: 480 }),
    },
    Interaction: {
      'hover-tab': workspace({}, postgresPage, { hover: '[role="tab"]:nth-of-type(2)' }),
      'hover-close': workspace({}, postgresPage, { hover: '[role="tab"]:nth-of-type(1) button' }),
      'hover-new-tab': workspace({}, postgresPage, { hover: '[aria-label="New chat ⌘T"]' }),
      'focus-tab': workspace({}, postgresPage, { focus: '[role="tab"]:nth-of-type(2)' }),
    },
  },
  { width: 900, height: 640, padded: false },
)
