import { memo, useEffect, useRef } from 'react'
import type { FileView, TopicDetail } from '@juno/contract'
import { discardMessage, messageListAtom, nowAtom, openExternal, retryMessage, registry, scrollSnapshotAtom, topicAtom, topicView, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { hueFor, MessageList, NewMessagesPill, TopicView as TopicViewFrame, type ActivateEvent } from '@juno/views'
import { closeTabById, openTopic } from './navigation'
import { useMessageActions, type ComposerHandle, type MessageActionsOutput } from './messageActions'
import { showPersonMenu } from './notifyActions'
import { scopeToChannel, showChannelMenu } from './placeMenus'
import { attach } from './attachments'
import { TopicComposer } from './TopicComposer'
import { downloadMessageFile, useTopicFiles } from './topic/files'
import { useTopicHeader } from './topic/header'
import { useOlderPages } from './topic/older'
import { listStatus, markRead, useDivider, useMarkRead, useTopicFetch, useWindowFocused, windowShown } from './topic/opening'
import {
  newMessages,
  useFirstFrame,
  useHeldPosition,
  useJumpToLatest,
  useMessageFlash,
  useOpenPosition,
  usePosition,
  useScrollRelease,
  useSendMeasure,
  useStickToBottom,
} from './topic/position'
import { eagerRows, firstRows, itemsOf, openIndex } from './topic/scroll'

/** Message times change at most at a day boundary; re-render the rows for it this often, not every minute. */
const TIME_STEP = 10 * 60_000

// Callbacks every row gets, created once and taking ids (performance 5.1).

function openThread(id: string, event: ActivateEvent): void {
  openTopic(id, { newTab: event.metaKey })
}

const personMenu = (person: { readonly id: string; readonly name: string }) => void showPersonMenu(person)

const retry = (clientMsgId: string) => void retryMessage(registry, clientMsgId)
const discard = (clientMsgId: string) => void discardMessage(registry, clientMsgId)

/** Every topic draws its art (or the Tide placeholder) except a DM's Main, which keeps the person, as the sidebar tile does. */
export function hasArt(detail: TopicDetail): boolean {
  return !(detail.kind === 'main' && (detail.channel.kind === 'im' || detail.channel.kind === 'mpim'))
}

export interface TopicTabProps {
  /** The tab that shows the topic. */
  readonly tabId: string
  /** The topic. */
  readonly id: string
}

/**
 * One topic tab (spec section 7; performance 3.3, 4.3 and 4.5). The tab
 * lives in an `<Activity>`: while hidden its effects are gone, so it marks
 * nothing and asks for nothing, and its DOM keeps the scroll position.
 *
 * - Opens at the "N new" divider, 80px below the header band, or at the bottom, in
 *   the layout effect of the first frame that has rows. A tab that was
 *   unmounted comes back at its `ScrollSnapshot` instead.
 * - The divider sits where the read pointer was when the tab first showed
 *   the topic, so marking read does not move it.
 * - At the bottom, a new message is scrolled into view before paint;
 *   scrolled up, the "N new messages" pill counts them.
 * - Near the top, the next older page is fetched, one request at a time,
 *   and the window widens; scroll anchoring keeps the rows in view still.
 * - Marks read by `shouldMarkRead`: on open and when shown, then at the
 *   bottom of a focused window.
 */
export const TopicTab = memo(function TopicTab({ tabId, id }: TopicTabProps) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  // A topic the store does not know (a saved tab whose topic is gone) closes its tab.
  useEffect(() => {
    if (detail === null) closeTabById(tabId)
  }, [tabId, detail])
  if (detail == null) return null
  return <Topic id={id} view={topicView(id, tabId)} detail={detail} />
})

/** Thread links in a preview open in a new tab, so the New chat and its draft stay. */
function openThreadInNewTab(id: string): void {
  openTopic(id, { newTab: true })
}

/**
 * A topic's latest messages, read-only: New chat's preview (spec section 9),
 * and the same for peek (section 5). The list alone, with no header or
 * composer, in `readOnly` mode (see `TopicProps`).
 */
export const TopicPreview = memo(function TopicPreview({ id, underHeader = true }: { readonly id: string; readonly underHeader?: boolean }) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  if (detail == null) return null
  return <Topic key={id} id={id} view={id} detail={detail} readOnly underHeader={underHeader} />
})

interface TopicProps {
  readonly id: string
  /**
   * Whose window and scroll position these are: `topicView(id, tabId)` in a
   * tab, so two tabs on one topic keep their own; the topic id in a preview.
   */
  readonly view: string
  readonly detail: TopicDetail
  /**
   * Read-only: the message list alone, opened at the bottom, with no "N new"
   * divider; nothing is marked read, the tab's scroll snapshot is neither
   * read nor written, and thread links open in a new tab. Otherwise the
   * topic as a tab shows it, with its header and composer.
   */
  readonly readOnly?: boolean
  /** The list runs under a floating header. Default true; peek has none. */
  readonly underHeader?: boolean
}

/** What a tab's rows do beyond reading: open images, retry and discard sends, the message actions and the menus. */
function rowActions(list: MessageWindow, messageActions: MessageActionsOutput, onOpenImage: (file: FileView) => void) {
  return {
    onOpenImage,
    onRetry: retry,
    onDiscard: discard,
    onMessageMenu: messageActions.onMessageMenu,
    actions: messageActions.actions,
    activeMessage: messageActions.activeMessage,
    confirmingDelete: messageActions.confirmingDelete,
    editing: messageActions.editing,
    onRowKey: messageActions.onRowKey,
    onToggleReaction: messageActions.onToggleReaction,
    onPersonMenu: personMenu,
    onChannelMenu: (chip: { readonly id: string; readonly name: string }) => {
      const known = list.refs.channels.get(chip.id)
      void showChannelMenu(known ?? { id: chip.id, kind: 'public', name: chip.name, label: `#${chip.name}`, tint: 'public' })
    },
  }
}

function Topic({ id, view, detail, readOnly = false, underHeader = true }: TopicProps) {
  const list = useAtomValue(messageListAtom(view))
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)
  const focused = useWindowFocused()
  // The hooks run their effects in this order; keep it.
  const position = usePosition(list)
  const { readAtOpen, at, dividerBefore } = useDivider(id, detail.lastReadTs, list, readOnly)
  const loading = useTopicFetch(id, view)
  const showWindow = windowShown(position.positioned, list, readAtOpen, loading.fetchState)
  const files = useTopicFiles()
  const scope = { id, view, readOnly, list }
  useOpenPosition(position, scope, showWindow)
  const flash = useMessageFlash(position, scope)
  useHeldPosition(position, list)
  useFirstFrame(position, scope, showWindow)
  useStickToBottom(position, list)
  useSendMeasure(list)
  useScrollRelease(position, scope)
  const older = useOlderPages(position, scope)
  useMarkRead(id, readOnly, detail.unreadCount, { positioned: position.positioned, focused, atBottom: position.atBottom })
  const header = useTopicHeader(detail, readOnly, position.drawnAll)
  const composer = useRef<ComposerHandle>(null)
  const messageActions = useMessageActions({ detail, list, scrollRef: position.scrollRef, composer })
  const jump = useJumpToLatest(position, scope)
  const people = list.refs.people
  const hueOf = (personId: string) => hueFor(people.get(personId)?.color ?? '', personId)
  // Until the first frame is on screen, the rows from `firstRows()` above the open position down; then all.
  const items = itemsOf(list)
  const rows = firstRows()
  const openAt = openIndex(list, at, readOnly ? undefined : registry.get(scrollSnapshotAtom(view)))
  const from = position.drawnAll ? 0 : Math.max(0, openAt - rows)
  const shown = from === 0 ? items : items.slice(from)
  const held = flash?.ts ?? position.heldAt
  const eager = eagerRows(list.order, openAt, held === undefined ? -1 : list.order.indexOf(held), rows)
  const pill = newMessages(position, list)
  const messages = (
    <MessageList
      items={showWindow ? shown : []}
      eager={eager}
      notDrawnAbove={showWindow ? from : 0}
      main={detail.kind === 'main'}
      now={now}
      status={listStatus(showWindow, list, loading)}
      older={!showWindow || list.order.length === 0 ? 'none' : older}
      {...(dividerBefore === undefined ? {} : { dividerBefore })}
      scrollRef={position.scrollRef}
      underHeader={underHeader}
      anchorRef={position.anchorRef}
      hueOf={hueOf}
      onOpenThread={readOnly ? openThreadInNewTab : openThread}
      onChannel={scopeToChannel}
      onLink={openExternal}
      onDownload={downloadMessageFile}
      {...(files.uploadProgress === undefined ? {} : { uploadProgress: files.uploadProgress })}
      {...(readOnly ? {} : rowActions(list, messageActions, files.setViewing))}
    />
  )
  if (readOnly) return messages
  const sent = () => {
    jump()
    void markRead(id)
  }
  return (
    <TopicViewFrame
      header={header}
      pill={pill.show ? <NewMessagesPill count={pill.count} onJump={jump} /> : undefined}
      composer={<TopicComposer key={id} detail={detail} onSent={sent} handle={composer} onArrowUpEmpty={messageActions.selectNewest} dropping={files.dropping} />}
      floating={<>{messageActions.floating}{files.viewer}</>}
      onFiles={(dropped) => attach(id, dropped)}
      onDragFiles={files.setDropping}
    >
      {messages}
    </TopicViewFrame>
  )
}
