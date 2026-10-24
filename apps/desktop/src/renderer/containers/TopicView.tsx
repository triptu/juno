import { memo, Suspense, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { TopicDetail } from '@juno/contract'
import { acknowledgeTopic, updateTabs, selectedTopicAtom, discardMessage, messageListAtom, nowAtom, retryMessage, registry, scrollSnapshotAtom, topicAtom, topicView, traceSend, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { chunk, hueFor, MessageList, NewMessagesPill, TopicView as TopicViewFrame, type ActivateEvent, type MediaViewing, type TopicHeaderReader } from '@juno/views'
import { closeTabById, openTopic, openTopicAt, openTopicAtInBackground, warmTopic } from './navigation'
import { useMessageActions, type ComposerHandle, type MessageActionsOutput } from './messageActions'
import { showPersonMenu } from './notifyActions'
import { closeMessageMenu } from './messageMenu'
import { takeComposerFocus } from './pageFocus'
import { scopeToChannel, showChannelMenu } from './placeMenus'
import { messageLinkInfo, openMessageLink, openPerson } from './slackLinks'
import { attach } from './attachments'
import { TopicComposer } from './TopicComposer'
import { downloadMessageFile, quickLookMessageFile, showMessageImageMenu, useTopicFiles } from './topic/files'
import { useTopicHeader } from './topic/header'
import { useNewerPages } from './topic/newer'
import { useOlderPages } from './topic/older'
import { listStatus, markRead, useDivider, useFromBottom, useMarkRead, useTopicFetch, useWindowFocused, windowShown } from './topic/opening'
import {
  edgesOf,
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
import { useReactionFailureToast } from './topic/reactionFailure'
import { eagerRows, firstRows, itemsOf, openIndex } from './topic/scroll'

/** Message times change at most at a day boundary; re-render the rows for it this often, not every minute. */
const TIME_STEP = 10 * 60_000

// Callbacks every row gets, created once and taking ids (performance 5.1).

function openThread(id: string, event: ActivateEvent): void {
  openTopic(id, { newTab: event.metaKey })
}

/** A broadcast reply's "in <topic title>" in Main: the thread, at the reply, which flashes; ⌘ opens it in a tab behind this one. */
function openReply(id: string, ts: string, event: ActivateEvent): void {
  if (event.metaKey) openTopicAtInBackground(id, ts)
  else openTopicAt(id, ts, { flash: true })
}

function openReplyInNewTab(id: string, ts: string, event: ActivateEvent): void {
  if (event.metaKey) openTopicAtInBackground(id, ts)
  else openTopicAt(id, ts, { newTab: true, flash: true })
}

/** Where a list's thread links and broadcast replies go; in a peek, to a new tab, so the tab under it stays. */
const THREAD_LINKS = { onOpenThread: openThread, onOpenReply: openReply }
const PEEK_THREAD_LINKS = { onOpenThread: openThreadInNewTab, onOpenReply: openReplyInNewTab }

const personMenu = (person: { readonly id: string; readonly name: string }) => void showPersonMenu(person)
const openPersonDm = (id: string, behind: boolean) => void openPerson(id, behind)
const DeactivatedNote = chunk(() => import('./topic/deactivated')).component((module) => module.DeactivatedNote)

const retry = (clientMsgId: string) => void retryMessage(registry, clientMsgId)
const discard = (clientMsgId: string) => void discardMessage(registry, clientMsgId)

/** Open the link menu prefetched after a topic paints, or fetch it immediately if needed. */
function showMessageLinkMenu(url: string, event: MouseEvent): void {
  const at = { x: event.clientX, y: event.clientY }
  void import('./linkMenu').then((menu) => menu.showLinkMenu(url, at))
}

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
 *   the topic, so marking read does not move it. Mark as unread moves it.
 * - At the bottom, a new message is scrolled into view before paint;
 *   scrolled up, the "N new messages" pill counts them.
 * - Near the top, the next older page is fetched, one request at a time,
 *   and the window widens; scroll anchoring keeps the rows in view still.
 * - Marks read by `shouldMarkRead`: on open and when shown, then at the
 *   bottom of a focused window, unless the topic was marked unread.
 */
export const TopicTab = memo(function TopicTab({ tabId, id }: TopicTabProps) {
  const result = useAtomValue(topicAtom(id))
  const detail = result._tag === 'Success' ? result.value : undefined
  const acknowledgedId = detail?.id
  useEffect(() => {
    if (acknowledgedId !== undefined && acknowledgedId !== id) {
      updateTabs(registry, tabs => acknowledgeTopic(tabs, id, acknowledgedId))
      if (registry.get(selectedTopicAtom) === id) registry.set(selectedTopicAtom, acknowledgedId)
    }
  }, [id, acknowledgedId])
  // Tests only: when the tab's topic view mounts and unmounts (`sendTrace.ts`).
  useEffect(() => {
    traceSend('tab mounted', () => ({ tab: tabId, topic: id }))
    return () => traceSend('tab unmounted', () => ({ tab: tabId, topic: id }))
  }, [tabId, id])
  // A topic the store does not know (a saved tab whose topic is gone) closes its tab.
  useEffect(() => {
    if (detail === null) closeTabById(tabId)
  }, [tabId, detail])
  if (detail == null) return null
  return <Topic id={id} view={topicView(id, tabId)} detail={detail} />
})

/** Thread links in a peek open in a new tab, so the tab under it stays. */
function openThreadInNewTab(id: string): void {
  openTopic(id, { newTab: true })
}

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
  /** In the peek popover: no floating header over the list, and the popover's tighter column. */
  readonly peek?: boolean
  /** A read-only preview opens media in its owning topic. */
  readonly onOpenPreviewMedia?: (viewing: MediaViewing) => void
  /**
   * The Search tab's reader (SPEC 10a): the whole topic, but it marks
   * nothing read until it is used. A press anywhere in it, or a key that
   * acts (typing, a reaction, a message's keys), counts as opening it, and
   * from then on it marks as an open topic does. Esc in its empty
   * composer goes back to the results. Its window shows as soon as it holds
   * the match it landed on (`landing`), which shows its sender even inside
   * their group, and the topic asks Slack for what the store lacks only
   * once `fetch` is set, so a held arrow asks only where it stops.
   */
  readonly reader?: { readonly header: TopicHeaderReader; readonly onEscape: () => void; readonly onUsed?: () => void; readonly landing?: string | undefined; readonly fetch?: boolean }
}

/** Keys that only move focus, step the reader's matches or leave it do not count as using the topic. */
const usesTopic = (event: KeyboardEvent) => !(event.key === 'Escape' || event.key === 'Tab' || event.key === 'Shift' || event.key === 'Meta' || event.key === 'Alt' || event.key === 'Control' || (event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')))

/**
 * The reader's "not yet used" state, the topic view's own, starting again with each topic: a press or a key
 * that acts uses it; Esc in its empty composer goes back to the results.
 */
function useReaderUse(reader: TopicProps['reader']) {
  const [used, setUsed] = useState(reader === undefined)
  const use = () => {
    if (used) return
    setUsed(true)
    reader?.onUsed?.()
  }
  if (reader === undefined) return { used, use, escape: (selectHovered: () => void) => selectHovered, activity: {} }
  return {
    used,
    use,
    escape: (selectHovered: () => void) => () => {
      const field = document.activeElement
      if (field instanceof HTMLTextAreaElement && field.value.trim() === '') reader.onEscape()
      else selectHovered()
    },
    activity: { onActivity: (event: PointerEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => (event.type === 'pointerdown' || usesTopic(event as KeyboardEvent)) && use() },
  }
}

/** What a tab's rows do beyond reading: open images, retry and discard sends, the message actions and the menus. */
function rowActions(list: MessageWindow, messageActions: MessageActionsOutput) {
  return {
    onRetry: retry,
    onDiscard: discard,
    onMessageMenu: messageActions.onMessageMenu,
    onCloseMessageMenu: closeMessageMenu,
    actions: messageActions.actions,
    activeMessage: messageActions.activeMessage,
    confirmingDelete: messageActions.confirmingDelete,
    editing: messageActions.editing,
    suggestions: messageActions.suggestions,
    onRowKey: messageActions.onRowKey,
    // ↓ past the last row goes to the composer only when that row is the topic's newest message: a window anchored
    // in history can end before it, and there ↓ on the last row stays put (the pill brings the newest back).
    onPastEnd: edgesOf(list).atEnd ? messageActions.focusComposer : undefined,
    onToggleReaction: messageActions.onToggleReaction,
    onPersonMenu: personMenu,
    onChannelMenu: (chip: { readonly id: string; readonly name: string }) => {
      const known = list.refs.channels.get(chip.id)
      void showChannelMenu(known ?? { id: chip.id, kind: 'public', name: chip.name, label: `#${chip.name}`, tint: 'public' })
    },
  }
}

/** Until the first frame is on screen, the rows from `firstRows()` above the open position down; then all. The held row is laid out eagerly. */
function drawnRows(list: MessageWindow, at: number, snapshot: Parameters<typeof openIndex>[2], drawnAll: boolean, held: string | undefined) {
  const items = itemsOf(list)
  const rows = firstRows()
  const openAt = openIndex(list, at, snapshot)
  const from = drawnAll ? 0 : Math.max(0, openAt - rows)
  return { from, shown: from === 0 ? items : items.slice(from), eager: eagerRows(list.order, openAt, held === undefined ? -1 : list.order.indexOf(held), rows) }
}

/** Download and Quick Look on a file card, one object for the app's life (performance 5.1). */
const FILE_ACTIONS = { onDownload: downloadMessageFile, onQuickLook: quickLookMessageFile } as const

export function Topic({ id, view, detail, readOnly = false, peek = false, onOpenPreviewMedia, reader }: TopicProps) {
  const list = useAtomValue(messageListAtom(view))
  useReactionFailureToast(list)
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)
  const focused = useWindowFocused()
  // The hooks run their effects in this order; keep it.
  const position = usePosition(list)
  const { readAtOpen, at, dividerBefore } = useDivider(id, detail.lastReadTs, detail.markedUnread === true, list, readOnly)
  const loading = useTopicFetch(detail.id, view, reader?.fetch ?? true, position.positioned)
  const landing = reader?.landing
  const showWindow = windowShown(position.positioned, list, readAtOpen, loading.fetchState) || (landing !== undefined && list.rows.has(landing))
  const firstAtOpen = useFromBottom(list, showWindow, position.positioned)
  const files = useTopicFiles(view)
  const openMedia = onOpenPreviewMedia ?? files.setViewing
  useOpenPosition(position, view, readOnly, list, showWindow)
  const flash = useMessageFlash(position, detail.id, readOnly, list)
  useHeldPosition(position, list)
  useFirstFrame(position, id, list, showWindow)
  useStickToBottom(position, list)
  useSendMeasure(list)
  useScrollRelease(position, view, readOnly)
  const older = useOlderPages(position, detail.id, view, list)
  useNewerPages(position, detail.id, view, list)
  const { used, use, escape, activity } = useReaderUse(reader)
  useMarkRead(detail.id, readOnly || !used, detail.unreadCount, detail.markedUnread === true, position.positioned, focused, position.atBottom)
  const header = useTopicHeader(detail, readOnly, position.drawnAll, reader?.header)
  const composer = useRef<ComposerHandle>(null)
  const messageActions = useMessageActions({ detail, list, scrollRef: position.scrollRef, composer, readOnly })
  const jump = useJumpToLatest(position, view, list)
  const people = list.refs.people
  const hueOf = (personId: string) => hueFor(people.get(personId)?.color ?? '', personId)
  const { from, shown, eager } = drawnRows(list, at, readOnly ? undefined : registry.get(scrollSnapshotAtom(view)), position.drawnAll, flash?.ts ?? position.heldAt)
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
      startsGroupAt={landing ?? firstAtOpen}
      fromBottom={firstAtOpen !== undefined}
      scrollRef={position.scrollRef}
      underHeader={!peek}
      popover={peek}
      anchorRef={position.anchorRef}
      hueOf={hueOf}
      {...(readOnly ? PEEK_THREAD_LINKS : THREAD_LINKS)}
      onPrefetchThread={warmTopic}
      onChannel={scopeToChannel}
      onPerson={openPersonDm}
      onLink={openMessageLink}
      linkInfo={messageLinkInfo} onLinkMenu={showMessageLinkMenu}
      {...FILE_ACTIONS}
      onOpenMedia={openMedia}
      onImageMenu={(ts, fileId, event) => showMessageImageMenu(list, ts, fileId, event, openMedia)}
      {...(files.uploadProgress === undefined ? {} : { uploadProgress: files.uploadProgress })}
      {...(readOnly ? {} : rowActions(list, messageActions))}
    />
  )
  if (readOnly) return messages
  const sent = () => { use(); jump(); void markRead(detail.id) }
  return (
    <TopicViewFrame
      header={header}
      pill={pill.show ? <NewMessagesPill count={pill.count} onJump={jump} /> : undefined}
      composer={detail.deactivated ? <Suspense><DeactivatedNote name={detail.channel.label} /></Suspense> : <TopicComposer key={id} detail={id === detail.id ? detail : { ...detail, id }} onSent={sent} handle={composer} takeFocus={(field) => takeComposerFocus(view, field)} onArrowUpTop={messageActions.selectNewest} onEscape={escape(messageActions.selectHovered)} dropping={files.dropping} />}
      floating={messageActions.floating}
      viewer={files.viewer}
      onFiles={(dropped) => attach(id, dropped)}
      onDragFiles={files.setDropping}
      {...activity}
    >
      {messages}
    </TopicViewFrame>
  )
}
