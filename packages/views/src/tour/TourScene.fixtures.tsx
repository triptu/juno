/**
 * The scenes the tour's screenshots are taken from (SPEC 4, "The tour").
 * Each is the window at its minimum size, 720 by 480, built from the real
 * views with gallery fixture data, so a screenshot shows the UI as it is
 * and nothing in it is real Slack content. `pnpm tour:shots` shoots every
 * scene in light and dark into `shots/`, and measures the boxes its
 * callouts point at.
 *
 * A scene names its callouts' targets on its root, in
 * `data-tour-anchors`: anchor name to Playwright selector. The script
 * fails when a selector finds nothing, so a renamed button cannot leave a
 * callout pointing at empty space.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { TopicDetail } from '@juno/contract'
import { defineFixtures, scene, TopicArt } from '@juno/ui'
import { ComposerSlot } from '../ComposerSlot'
import { details, me, thread, window as messages } from '../fixtures/messages'
import { art, channels, NOW, people, rows, rowsById } from '../fixtures/topics'
import { noopActions } from '../juno-chat/commands'
import type { ChatItem } from '@juno/agent-contract'
import { cardId, juno, NOW as CHAT_NOW, open, owner, places, proposedId } from '../juno-chat/fixtures/data'
import { JunoChatFrame } from '../juno-chat/JunoChatFrame'
import { JunoChatList } from '../juno-chat/JunoChatList'
import { JunoComposer } from '../juno-chat/JunoComposer'
import { JunoHeader } from '../juno-chat/JunoHeader'
import { MessageList } from '../MessageList'
import { PeekView } from '../PeekView'
import { Shell } from '../Shell'
import { Sidebar, type SidebarNavTarget, type SidebarViewPill } from '../Sidebar'
import { relativeTime } from '../time'
import { TitlebarNav } from '../TitlebarNav'
import { TopicHeader } from '../TopicHeader'
import { TopicList } from '../TopicList'
import { TopicRow } from '../TopicRow'
import { TopicView } from '../TopicView'
import { Workspace, type WorkspaceTab } from '../Workspace'
import type { TourStepId } from './copy'

const noop = () => {}

/** The window at its minimum size (inventory 1): the tour's pictures are this, at 2x. */
export const TOUR_SCENE = { width: 720, height: 480 } as const

/** Wide enough for two-line previews, and leaves the workspace room for a message column. */
const SIDEBAR_WIDTH = 320

const MINUTE = 60_000

const nav = <TitlebarNav sidebarHidden={false} canGoBack canGoForward={false} onToggleSidebar={noop} onBack={noop} onForward={noop} />

const mayaTile = { kind: 'person', ...people.maya, src: people.maya.avatarUrl } as const

const tabs = {
  postgres: { id: rows.postgres.id, title: 'Postgres 16 migration plan', icon: 'hash', tile: { kind: 'art', topicId: `t:${rows.postgres.id}`, recipe: art.database } },
  roadmap: { id: rows.roadmap.id, title: 'Q4 roadmap cuts', icon: 'hash', tile: { kind: 'art', topicId: `t:${rows.roadmap.id}` } },
  maya: { id: rows.mayaMain.id, title: 'Maya Chen', icon: 'user', tile: mayaTile },
  juno: { id: 'tab-juno', title: 'Juno', icon: 'juno' },
  home: { id: 'tab-home', title: 'Home', icon: 'home' },
} as const satisfies Record<string, WorkspaceTab>

// The views a new owner might make, after Automated, which Juno makes (SPEC 5, "Automated").
const views: ReadonlyArray<SidebarViewPill> = [
  { id: 'automated', name: 'Automated', icon: 'robot', color: 'teal', mention: false },
  { id: 'vwork', name: 'Work', icon: 'briefcase', color: 'midnight', mention: false },
  { id: 'vrelease', name: 'Releases', icon: 'rocket', color: 'marigold', mention: false },
]

interface WindowProps {
  readonly step: TourStepId
  readonly anchors: Readonly<Record<string, string>>
  readonly ids: ReadonlyArray<string>
  readonly selected?: string
  readonly activeNav?: SidebarNavTarget
  readonly sidebarViews?: boolean
  readonly tabs: ReadonlyArray<WorkspaceTab>
  readonly activeTab: string
  readonly page: ReactNode
  readonly peek?: ReactNode
}

/** The signed-in window with the rows, tabs and page the step needs. */
function Window({ step, anchors, ids, selected, activeNav, sidebarViews = false, tabs: open, activeTab, page, peek }: WindowProps) {
  const sidebar = (
    <Sidebar
      titlebarLeading={nav}
      account={{ name: 'Tushar', initials: 'T', hue: 'cyan' }}
      {...(activeNav === undefined ? {} : { activeNav })}
      junoUnread={0}
      filter={{ kind: 'all', unreadOnly: false }}
      dots={{ channels: false, dms: false }}
      accountMenuOpen={false}
      onAccountMenu={noop}
      onSearch={noop}
      onNavigate={noop}
      onFilterKind={noop}
      onToggleUnread={noop}
      onClearScope={noop}
      {...(sidebarViews ? { views, onFilterView: noop, onNewView: noop, onViewMenu: noop, onMoveView: noop } : {})}
    >
      <TopicList
        sections={[{ id: 'recent', ids }]}
        enterEmpty={false}
        renderRow={(id) => {
          const row = rowsById.get(id)
          return row === undefined ? null : (
            <TopicRow key={id} row={row} time={relativeTime(row.lastActivityAt, NOW)} selected={id === selected} tabbable={id === (selected ?? ids[0])} onOpen={noop} onResolve={noop} />
          )
        }}
      />
    </Sidebar>
  )
  return (
    <div data-tour-scene={step} data-tour-anchors={JSON.stringify(anchors)} style={{ width: '100%', height: '100%', display: 'flex' }}>
      <Shell
        sidebarWidth={SIDEBAR_WIDTH}
        onSidebarResize={noop}
        onSidebarResetWidth={noop}
        onSidebarCollapse={noop}
        peek={peek}
        sidebar={sidebar}
      >
        <Workspace tabs={open} activeId={activeTab} onSelectTab={noop} onCloseTab={noop} onNewTab={noop} onMoveTab={noop} onTabContextMenu={noop}>
          {page}
        </Workspace>
      </Shell>
    </div>
  )
}

const topicPage = (detail: TopicDetail, items: Parameters<typeof MessageList>[0]['items']) => (
  <TopicView
    header={<TopicHeader detail={detail} onMenu={noop} onPill={noop} juno={{ open: false, onToggle: noop }} {...(detail.kind === 'main' ? { onThreads: noop } : { onResolve: noop })} />}
    composer={<ComposerSlot placeholder={detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply'} />}
  >
    <MessageList items={items} main={detail.kind === 'main'} now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} />
  </TopicView>
)

/** Maya's DM, outside threads: the message the offsite thread started from, and the rest of the day. */
const mayaMessages = messages([
  {
    ago: 3 * 60,
    from: people.maya,
    text: 'Can we pick a slot for the offsite?',
    thread: { id: rows.offsite.id, replyCount: 3, label: '3 replies', title: 'Offsite: Wednesday afternoon slot', titleSource: 'manual', lastReplyAt: NOW - 38 * MINUTE },
  },
  { ago: 2 * 60, from: me, text: 'Lunch tomorrow?' },
  { ago: 16, from: people.maya, text: 'Sent you the deck. Tell me if the pricing slide reads.' },
])

const mayaMain: TopicDetail = { ...details.lunch, id: rows.mayaMain.id, title: 'Maya Chen', channel: channels.maya, messageCount: 9, lastActivityTs: mayaMessages.at(-1)?.message.ts ?? '' }

/** The Postgres thread in the peek: its last messages, as a held key shows them. */
const peekOfPostgres = (
  <PeekView title={details.postgres.title} where={details.postgres.channel.label} art={<TopicArt topicId={details.postgres.id} recipe={art.database} size={20} />}>
    <MessageList items={thread.slice(-4)} main={false} now={NOW} underHeader={false} popover />
  </PeekView>
)

/** A request, and the message to Maya that Juno proposes, waiting for Send. */
const junoItems: ReadonlyArray<ChatItem> = [
  owner('tour-ask', 'Tell Maya Wednesday at 2 works', 'single', { _tag: 'sent' }, CHAT_NOW - 2 * MINUTE),
  ...juno('tour-answer', '', {
    at: CHAT_NOW - MINUTE,
    cards: [
      {
        _tag: 'sendMessage',
        id: cardId('tour-send'),
        status: open,
        messages: [{ id: proposedId('tour-send-1'), target: places.maya, text: 'Wednesday at 2 works for me.', result: { _tag: 'pending' } }],
      },
    ],
  }),
]

/** The Juno tab scrolled to the request, just under the header, so the proposed message and its Send show below it. */
function JunoPage() {
  const scrollRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    scrollRef.current?.querySelector('[data-chat-owner]')?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <JunoChatFrame header={<JunoHeader banner={{ _tag: 'none' }} menuOpen={false} onMenu={noop} onOpenPage={noop} onResume={noop} />} composer={<JunoComposer value="" onChange={noop} onSend={noop} enabled />}>
      <JunoChatList items={junoItems} banner={{ _tag: 'none' }} moreAbove={false} moreBelow={false} now={CHAT_NOW} actions={noopActions} onSuggest={noop} enterEmpty={false} scrollRef={scrollRef} />
    </JunoChatFrame>
  )
}

const recent = [rows.postgres.id, rows.lowerBound.id, rows.mayaMain.id, rows.roadmap.id, rows.offsite.id, rows.hiring.id]

/** The scenes in tour order, each with the anchors its step's callouts name. */
export const tourScenes: Readonly<Record<TourStepId, () => ReactNode>> = {
  topics: () => (
    <Window
      step="topics"
      anchors={{ thread: `[data-topic-id="${rows.postgres.id}"]`, main: `[data-topic-id="${rows.lowerBound.id}"]` }}
      ids={recent}
      selected={rows.postgres.id}
      tabs={[tabs.postgres, tabs.roadmap]}
      activeTab={tabs.postgres.id}
      page={topicPage(details.postgres, thread)}
    />
  ),
  'dm-twice': () => (
    <Window
      step="dm-twice"
      anchors={{ main: `[data-topic-id="${rows.mayaMain.id}"]`, thread: `[data-topic-id="${rows.offsite.id}"]`, link: `[data-thread-link="${rows.offsite.id}"]` }}
      ids={[rows.mayaMain.id, rows.offsite.id, rows.postgres.id, rows.lowerBound.id, rows.roadmap.id]}
      selected={rows.mayaMain.id}
      tabs={[tabs.maya, tabs.postgres]}
      activeTab={tabs.maya.id}
      page={topicPage(mayaMain, mayaMessages)}
    />
  ),
  around: () => (
    <Window
      step="around"
      anchors={{ nav: 'nav[aria-label="Pages"]', search: 'role=button[name=/^Search/]', peek: '[data-peek]' }}
      ids={recent}
      tabs={[tabs.home, tabs.roadmap, tabs.maya]}
      activeTab={tabs.roadmap.id}
      page={topicPage(details.postgres, thread)}
      peek={peekOfPostgres}
    />
  ),
  yours: () => (
    <Window
      step="yours"
      anchors={{ automated: '[data-view-pill="automated"]', 'new-view': 'role=button[name=/^New view/]', settings: 'role=button[name=/^Account/]' }}
      ids={recent}
      sidebarViews
      tabs={[tabs.postgres, tabs.roadmap]}
      activeTab={tabs.postgres.id}
      page={topicPage(details.postgres, thread)}
    />
  ),
  juno: () => (
    <Window
      step="juno"
      anchors={{ nav: 'nav[aria-label="Pages"] >> role=button[name=/^Juno/]', send: '[data-chat-card="sendMessage"] >> role=button[name=/^Send/]' }}
      ids={recent}
      activeNav="juno"
      tabs={[tabs.juno, tabs.postgres]}
      activeTab={tabs.juno.id}
      page={<JunoPage />}
    />
  ),
}

const frame = { ...TOUR_SCENE, padded: false } as const

export default defineFixtures(
  Shell,
  {
    Steps: {
      topics: scene(tourScenes.topics),
      'dm-twice': scene(tourScenes['dm-twice']),
      around: scene(tourScenes.around),
      yours: scene(tourScenes.yours),
      juno: scene(tourScenes.juno),
    },
  },
  frame,
)
