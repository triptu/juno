import { useState } from 'react'
import type { TopicDetail } from '@juno/contract'
import type { MessageListItem } from './MessageList'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { ComposerSlot } from './ComposerSlot'
import { details, dmMain, dmThread, main, mainDividerBefore, thread } from './fixtures/messages'
import { art, NOW, people } from './fixtures/topics'
import { MessageList } from './MessageList'
import { TopicHeader } from './TopicHeader'
import { TitlebarNav } from './TitlebarNav'
import { TopicView } from './TopicView'
import { noopActions } from './juno-chat/commands'
import { day, juno, owner } from './juno-chat/fixtures/data'
import { JunoChatFrame } from './juno-chat/JunoChatFrame'
import { JunoChatList } from './juno-chat/JunoChatList'
import { JunoComposer } from './juno-chat/JunoComposer'
import { JunoHeader, JunoPanelActions } from './juno-chat/JunoHeader'
import { JunoPanelContext, type JunoPanelContextProps } from './juno-chat/JunoPanelContext'
import { Workspace, type WorkspaceProps, type WorkspaceTab } from './Workspace'

const noop = () => {}

const mayaTile = { kind: 'person', ...people.maya, src: people.maya.avatarUrl } as const

const tabs = {
  eng: { id: 'C0ENG:main', title: 'eng', icon: 'hash', tile: { kind: 'art', topicId: 'm:C0ENG', recipe: art.bell } } satisfies WorkspaceTab,
  postgres: { id: 'C0ENG:1760000000.000100', title: 'Postgres 16 migration plan', icon: 'hash', tile: { kind: 'art', topicId: 't:C0ENG:1760000000.000100', recipe: art.database } } satisfies WorkspaceTab,
  density: { id: 'C0DESIGNREV:1759900000.000900', title: 'Thread list density', icon: 'hash', tile: { kind: 'art', topicId: 't:C0DESIGNREV:1759900000.000900', recipe: art.people } } satisfies WorkspaceTab,
  // Its art is not drawn yet: the placeholder shape.
  hiring: { id: 'C0HIRING:1760000000.000300', title: 'Rina Sato · Staff backend', icon: 'lock', tile: { kind: 'art', topicId: 't:C0HIRING:1760000000.000300' } } satisfies WorkspaceTab,
  mayaMain: { id: 'D0MAYA:main', title: 'Maya Chen', icon: 'user', tile: mayaTile } satisfies WorkspaceTab,
  maya: { id: 'D0MAYA:1759990000.000500', title: 'Offsite: Wednesday afternoon slot', icon: 'user', tile: mayaTile } satisfies WorkspaceTab,
  // A person with no photo: initials.
  dev: { id: 'D0DEV:main', title: 'Dev Patel', icon: 'user', tile: { kind: 'person', ...people.dev } } satisfies WorkspaceTab,
  group: { id: 'G0MAYALEO:main', title: 'Maya, Leo', icon: 'users' } satisfies WorkspaceTab,
  pinnedEng: { id: 'tab-pinned-eng', title: 'eng', icon: 'hash', pinned: true, tile: { kind: 'art', topicId: 'm:C0ENG', recipe: art.bell } } satisfies WorkspaceTab,
  pinnedMaya: { id: 'tab-pinned-maya', title: 'Offsite: Wednesday afternoon slot', icon: 'user', pinned: true, unread: true, tile: mayaTile } satisfies WorkspaceTab,
  densityUnread: { id: 'tab-density-unread', title: 'Thread list density', icon: 'hash', unread: true, tile: { kind: 'art', topicId: 't:C0DESIGNREV:1759900000.000900', recipe: art.people } } satisfies WorkspaceTab,
  home: { id: 'tab-home', title: 'Home', icon: 'home' } satisfies WorkspaceTab,
  juno: { id: 'tab-juno', title: 'Juno', icon: 'juno' } satisfies WorkspaceTab,
} as const

/** Topic art, a placeholder, DM photos, initials, a group DM and pages side by side. */
const mixedTabs = [tabs.home, tabs.postgres, tabs.maya, tabs.hiring, tabs.dev, tabs.group, tabs.juno]

const browserTabs = [tabs.pinnedEng, tabs.pinnedMaya, tabs.postgres, tabs.densityUnread, tabs.hiring]
const sidebarControls = <TitlebarNav sidebarHidden canGoBack canGoForward={false} onToggleSidebar={noop} onBack={noop} onForward={noop} />

/** Thirty-seven topic tabs, the last one active, so the strip has to scroll to show it. */
const thirtySeven: ReadonlyArray<WorkspaceTab> = Array.from({ length: 37 }, (_, index) => {
  const sample = [tabs.postgres, tabs.hiring, tabs.density, tabs.maya][index % 4] ?? tabs.postgres
  return { ...sample, id: `${sample.id}:${index}`, title: `${sample.title} ${index + 1}` }
})
const lastTab = thirtySeven[thirtySeven.length - 1]?.id

const base: Omit<WorkspaceProps, 'children'> = { tabs: [tabs.postgres, tabs.density], activeId: tabs.postgres.id, onSelectTab: noop, onCloseTab: noop, onNewTab: noop, onMoveTab: noop, onTabContextMenu: noop }

const postgresPage = (
  <TopicView header={<TopicHeader detail={details.postgres} onMenu={noop} onPill={noop} onResolve={noop} juno={{ open: false, onToggle: noop }} />} composer={<ComposerSlot placeholder="Reply" />}>
    <MessageList items={thread} main={false} now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} />
  </TopicView>
)

const postgresPanelPage = (
  <TopicView header={<TopicHeader detail={details.postgres} onMenu={noop} onPill={noop} onResolve={noop} juno={{ open: true, onToggle: noop }} />} composer={<ComposerSlot placeholder="Reply" />}>
    <MessageList items={thread} main={false} now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} />
  </TopicView>
)

const engPage = (
  <TopicView header={<TopicHeader detail={details.engMain} onMenu={noop} onPill={noop} juno={{ open: false, onToggle: noop }} />} composer={<ComposerSlot placeholder="Message #eng" />}>
    <MessageList items={main} main now={NOW} dividerBefore={mainDividerBefore} onOpenThread={noop} onChannel={noop} onLink={noop} />
  </TopicView>
)

const engPanelPage = (
  <TopicView header={<TopicHeader detail={details.engMain} onMenu={noop} onPill={noop} juno={{ open: true, onToggle: noop }} />} composer={<ComposerSlot placeholder="Message #eng" />}>
    <MessageList items={main} main now={NOW} dividerBefore={mainDividerBefore} onOpenThread={noop} onChannel={noop} onLink={noop} />
  </TopicView>
)

/** A topic page as the app draws it: a thread gets Resolve and Follow, a Main neither. */
const topicPage = (detail: TopicDetail, items: ReadonlyArray<MessageListItem>, placeholder: string) => {
  const isMain = detail.kind === 'main'
  return (
    <TopicView header={<TopicHeader detail={detail} onMenu={noop} onPill={noop} juno={{ open: false, onToggle: noop }} {...(isMain ? {} : { onResolve: noop, onFollow: noop })} />} composer={<ComposerSlot placeholder={placeholder} />}>
      <MessageList items={items} main={isMain} now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} />
    </TopicView>
  )
}

/** The header's right island over real conversations: a DM's thread and Main, #eng's Main, a thread to resolve and one to follow. */
const headerPages = {
  dmThread: topicPage(details.offsite, dmThread, 'Reply'),
  dmMain: topicPage(details.mayaMain, dmMain, 'Message Maya Chen'),
  channelMain: topicPage(details.engMain, main, 'Message #eng'),
  threadResolve: topicPage(details.postgres, thread, 'Reply'),
  threadFollow: topicPage({ ...details.postgres, subscribed: false, status: 'unsubscribed' }, thread, 'Reply'),
}

const panelItems = [
  day(0),
  owner('m-w1', 'is this settled?', 'single', { _tag: 'sent' }, NOW - 5 * 60_000, { about: { _tag: 'topic', topicId: 'C0ENG:1760000000.000100', title: 'Postgres 16 migration plan' } }),
  ...juno('m-w1-r', 'Not yet. Leo asked for a reviewer from platform before Thursday, and nobody has said yes.', { at: NOW - 4 * 60_000 }),
]

const postgresPlace = { tint: 'public', label: 'eng · Postgres 16 migration plan', name: 'eng' } as const

/** The Juno panel as the workspace's side shows it, beside the Postgres topic. */
const panel = (context: JunoPanelContextProps, items: Parameters<typeof JunoChatList>[0]['items'] = panelItems) => (
  <JunoChatFrame
    column="panel"
    header={<JunoHeader column="panel" banner={{ _tag: 'none' }} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} actions={<JunoPanelActions onOpenInTab={noop} onClose={noop} />} />}
    composer={<JunoComposer column="panel" value="" onChange={noop} onSend={noop} enabled placeholder="Ask about this topic" context={<JunoPanelContext place={postgresPlace} {...context} />} />}
  >
    <JunoChatList column="panel" items={items} banner={{ _tag: 'none' }} moreAbove={false} moreBelow={false} now={NOW} actions={noopActions} onSuggest={noop} enterEmpty={false} />
  </JunoChatFrame>
)

const junoPanel = panel({})
// The owner's case: a Main in a channel with a long name.
const longMainPanel = panel({ place: { tint: 'public', label: 'proj-trainingdata-pipeline-and-model-evaluation-review-q4 · Main', name: 'proj-trainingdata-pipeline-and-model-evaluation-review-q4' } })
// The chip quotes the selection: a short one whole, a long one cut at a word, several messages by count.
const selection = { text: 'logical replication', sender: 'Leo', ts: '1712000000.000300' }
const longSelection = { text: 'We could use logical replication for the cutover and keep the old primary as a fallback.', sender: 'Leo', ts: '1712000000.000300' }
const multiSelection = { text: 'We could use logical replication for the cutover.\nAgreed, if the lag stays under a second.\nI can run the dry run on Thursday.', sender: 'Leo', ts: '1712000000.000300', messages: 3 }

const junoPage = (
  <JunoChatFrame header={<JunoHeader banner={{ _tag: 'none' }} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} />} composer={<JunoComposer value="" onChange={noop} onSend={noop} enabled />}>
    <JunoChatList items={panelItems} banner={{ _tag: 'none' }} moreAbove={false} moreBelow={false} now={NOW} actions={noopActions} onSuggest={noop} enterEmpty={false} />
  </JunoChatFrame>
)

/** The strip with a drop that moves the tab. The tab being dragged is active, as a press in the app makes it; a press here selects nothing, so pressing moves nothing. */
function Reorderable() {
  const [order, setOrder] = useState<ReadonlyArray<WorkspaceTab>>(mixedTabs)
  const move = (id: string, index: number) =>
    setOrder((current) => {
      const tab = current.find((other) => other.id === id)
      return tab === undefined ? current : current.filter((other) => other !== tab).toSpliced(index, 0, tab)
    })
  return (
    <Workspace {...base} tabs={order} activeId={tabs.dev.id} onMoveTab={move}>
      {postgresPage}
    </Workspace>
  )
}

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
    // The strip: "+" right after the last tab, and at the strip's end once the tabs scroll.
    Strip: {
      'one-tab': workspace({ tabs: [tabs.postgres], activeId: tabs.postgres.id }, postgresPage),
      'many-tabs': workspace({ tabs: [tabs.pinnedEng, tabs.postgres, tabs.hiring, tabs.densityUnread], activeId: tabs.postgres.id }, postgresPage),
      overflowing: workspace({ tabs: thirtySeven, ...(lastTab === undefined ? {} : { activeId: lastTab }) }, postgresPage, { width: 960, height: 480 }),
      'one-topic-in-two-tabs': workspace({ tabs: [tabs.postgres, { ...tabs.postgres, id: 'tab-postgres-2' }, tabs.home, { ...tabs.home, id: 'tab-home-2' }], activeId: 'tab-postgres-2' }, postgresPage),
    },
    Page: {
      // Only before the saved tabs have been read: there is otherwise always a tab.
      'nothing-open': workspace({ tabs: [] }),
      'topic-open': workspace({}, postgresPage),
      'main-open': workspace({ tabs: [tabs.eng, tabs.density], activeId: tabs.eng.id }, engPage),
      'many-tabs': workspace({ tabs: [tabs.postgres, tabs.hiring, tabs.eng, tabs.density, tabs.maya], activeId: tabs.eng.id }, engPage),
      'minimum-window': workspace({ tabs: [tabs.postgres, tabs.hiring, tabs.eng, tabs.density, tabs.maya], activeId: tabs.eng.id }, engPage, { width: 720, height: 480 }),
      'pinned-and-unread': workspace({ tabs: browserTabs, activeId: tabs.postgres.id }, postgresPage),
      'pinned-active': workspace({ tabs: browserTabs, activeId: tabs.pinnedEng.id }, engPage),
      // Home's content is the empty workspace until the Home page is built.
      'home-tab': workspace({ tabs: [tabs.home, tabs.postgres], activeId: tabs.home.id }),
      'juno-tab': workspace({ tabs: [tabs.postgres, tabs.juno], activeId: tabs.juno.id }, junoPage),
      // The topic keeps 480px or more: the panel floats beside it at its default 440px.
      'juno-panel': workspace({ side: junoPanel }, postgresPanelPage, { width: 1200, height: 720 }),
      // Dragged wider, to 600px.
      'juno-panel-wide': workspace({ side: junoPanel, sideWidth: 600 }, postgresPanelPage, { width: 1440, height: 720 }),
      // The chips in the composer say what Juno sees: the topic, and the selection quoted while text is selected in it.
      'juno-panel-context': workspace({ side: panel({}) }, postgresPanelPage, { width: 1200, height: 720 }),
      // A long channel name cuts with an ellipsis inside the topic chip.
      'juno-panel-long-name': workspace({ side: longMainPanel }, engPanelPage, { width: 1200, height: 720 }),
      'juno-panel-selection': workspace({ side: panel({ selection, onRemoveSelection: noop }) }, postgresPanelPage, { width: 1200, height: 720 }),
      'juno-panel-selection-long': workspace({ side: panel({ selection: longSelection, onRemoveSelection: noop }) }, postgresPanelPage, { width: 1200, height: 720 }),
      'juno-panel-selection-messages': workspace({ side: panel({ selection: multiSelection, onRemoveSelection: noop }) }, postgresPanelPage, { width: 1200, height: 720 }),
      // The panel at its narrowest with a selection: the topic chip names the place alone ("eng"); its tooltip keeps the title.
      'juno-panel-selection-narrow': workspace({ side: panel({ selection: longSelection, onRemoveSelection: noop }), sideWidth: 360 }, postgresPanelPage, { width: 1200, height: 720 }),
      // At its narrowest with no selection, the chip keeps the topic's title.
      'juno-panel-narrow': workspace({ side: junoPanel, sideWidth: 360 }, postgresPanelPage, { width: 1200, height: 720 }),
      // Ask Juno about a person: the line names them instead of the topic.
      'juno-panel-about': workspace({ side: panel({ about: { _tag: 'person', userId: 'U0MAYA', name: 'Maya Chen' }, onRemoveAbout: noop }) }, postgresPanelPage, { width: 1200, height: 720 }),
      // Nothing said yet: the empty chat with its suggestion chips.
      'juno-panel-empty': workspace({ side: panel({}, []) }, postgresPanelPage, { width: 1200, height: 720 }),
      // The panel gives way to keep the topic 480px wide, down to its 360px minimum.
      'juno-panel-gives-way': workspace({ side: junoPanel }, postgresPanelPage, { width: 900, height: 640 }),
      // Under that the panel covers the topic, which shows through it.
      'juno-panel-covers': workspace({ side: junoPanel }, postgresPanelPage, { width: 760, height: 640 }),
      'sidebar-hidden': workspace({ tabs: browserTabs, activeId: tabs.postgres.id, leading: sidebarControls }, postgresPage),
      'sidebar-hidden-minimum-window': workspace({ tabs: browserTabs, activeId: tabs.postgres.id, leading: sidebarControls }, postgresPage, { width: 720, height: 480 }),
      'thirty-seven-tabs': workspace({ tabs: thirtySeven, ...(lastTab === undefined ? {} : { activeId: lastTab }) }, postgresPage),
      'thirty-seven-tabs-minimum-window': workspace({ tabs: thirtySeven, ...(lastTab === undefined ? {} : { activeId: lastTab }) }, postgresPage, { width: 720, height: 480 }),
    },
    // The topic header's right island on real conversations (the gallery's TopicHeaderInPage adds the huddle control).
    Header: {
      'dm-thread': workspace({ tabs: [tabs.maya, tabs.postgres], activeId: tabs.maya.id }, headerPages.dmThread, { width: 1100, height: 640 }),
      'dm-main': workspace({ tabs: [tabs.mayaMain, tabs.postgres], activeId: tabs.mayaMain.id }, headerPages.dmMain, { width: 1100, height: 640 }),
      'channel-main': workspace({ tabs: [tabs.eng, tabs.postgres], activeId: tabs.eng.id }, headerPages.channelMain, { width: 1100, height: 640 }),
      'thread-resolve': workspace({ tabs: [tabs.eng, tabs.postgres], activeId: tabs.postgres.id }, headerPages.threadResolve, { width: 1100, height: 640 }),
      'thread-follow': workspace({ tabs: [tabs.eng, tabs.postgres], activeId: tabs.postgres.id }, headerPages.threadFollow, { width: 1100, height: 640 }),
    },
    // Each tab's icon: the topic's art, the DM person's photo, the page's glyph. Inactive ones dim with their title.
    'Tab icons': {
      mixed: workspace({ tabs: mixedTabs, activeId: tabs.postgres.id }, postgresPage, { width: 1440 }),
      'mixed-hover': workspace({ tabs: mixedTabs, activeId: tabs.postgres.id }, postgresPage, { width: 1440, hover: '[data-tab]:nth-of-type(3) [role="tab"]' }),
      'pinned-mixed': workspace({ tabs: [tabs.pinnedEng, tabs.pinnedMaya, tabs.postgres, tabs.maya, tabs.home], activeId: tabs.maya.id }, postgresPage, { width: 1200 }),
    },
    // Dragging a tab: it follows the pointer and the tabs it passed slide aside.
    Reorder: {
      'mid-drag': scene<WorkspaceProps>(() => <Reorderable />, { width: 1440, drag: { from: '[data-tab]:nth-of-type(5) [role="tab"]', by: -300 } }),
    },
    Interaction: {
      'hover-tab': workspace({}, postgresPage, { hover: '[data-tab]:nth-of-type(2) [role="tab"]' }),
      'hover-close': workspace({}, postgresPage, { hover: '[data-tab]:nth-of-type(1) button' }),
      'hover-new-tab': workspace({}, postgresPage, { hover: '[aria-label="New tab ⌘T"]' }),
      'focus-tab': workspace({}, postgresPage, { focus: '[data-tab]:nth-of-type(2) [role="tab"]' }),
    },
  },
  { width: 900, height: 640, padded: false },
)
