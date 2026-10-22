import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MessageView } from '@juno/contract'
import { defineFixtures, fixture, scene, TooltipLayer, type FixtureFrame } from '@juno/ui'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { conversation } from './fixtures/conversation'
import {
  emojiOnly,
  failedFile,
  failedSend,
  hostile,
  longCode,
  main as mainStream,
  mainDividerBefore,
  manyReactions,
  mentions,
  pendingFile,
  rtl,
  sending,
  thread,
  threadDividerBefore,
  uploadFailed,
  uploading,
  withDownloads,
  window as messageWindow,
  p,
  withFiles,
} from './fixtures/messages'
import { albumOf, mediaAndPdf, mixedMedia, singleAudio, singleImage, singleVideo, withDocuments } from './fixtures/media'
import { NOW, people } from './fixtures/topics'
import { noopActions } from './fixtures/actions'
import { InlineEdit } from './InlineEdit'
import { MessageList, type MessageListItem, type MessageListProps } from './MessageList'

const noop = () => {}

const base: Pick<MessageListProps, 'now' | 'onOpenThread' | 'onOpenReply' | 'onChannel' | 'onLink'> = { now: NOW, onOpenThread: noop, onOpenReply: noop, onChannel: noop, onLink: noop }

const state = (props: Partial<MessageListProps> & Pick<MessageListProps, 'items' | 'main'>, frame?: FixtureFrame) => fixture<MessageListProps>({ ...base, ...props }, frame)

const ROW = '[data-message-row]'

/**
 * A send settles: the pending row is replaced by the message Slack stored,
 * which looks the same, so nothing in the list moves. The test drives it
 * through `window.__fixtureControls.settle`.
 */
function PendingSettles() {
  const [settled, setSettled] = useState(false)
  useFixtureControl('settle', () => setSettled(true))
  const last = sending[2]!
  const items = settled ? [...sending.slice(0, 2), { ...last, message: { ...settledMessage, groupStart: last.message.groupStart } }] : sending
  return <MessageList {...base} items={items} main={false} />
}
const settledMessage: MessageView = (() => {
  const { pending: _pending, ...rest } = sending[2]!.message
  const ts = `${Math.floor(NOW / 1000)}.000999`
  return { ...rest, id: ts, ts }
})()

/** `items` with the reactions of row `index` replaced. */
const withReactions = (items: ReadonlyArray<MessageListItem>, index: number, reactions: MessageView['reactions']): ReadonlyArray<MessageListItem> =>
  items.map((item, i) => (i === index ? { ...item, message: { ...item.message, reactions } } : item))

/** The row with no reactions and the row with a 👍 chip (yours) in the thread fixture. */
const BARE = 2
const CHIPPED = 3

/**
 * Reactions change under the owner's eyes: a chip joins a row of chips, a
 * count goes up, a chip leaves, and the first chip of a message appears and
 * goes. The test drives each step through `window.__fixtureControls` and
 * checks what moved.
 */
/**
 * The delete is asked for a frame after the list has its scroll, as in the
 * app, where it is asked of a list at rest; `settle` runs first in that frame,
 * once the rows have laid out.
 */
function useAskAfterScroll(settle?: () => void): boolean {
  const [asking, setAsking] = useState(false)
  const settleRef = useRef(settle)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      settleRef.current?.()
      setAsking(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return asking
}

/**
 * The list opened scrolled so its first row's name line is under the header
 * band's place (`scroll-padding-top`) while its text shows, and that row asks
 * to confirm a delete: the confirm flips below the row, since above it there
 * is no room.
 */
function ScrolledUnderBand() {
  const scrollRef = useRef<HTMLElement>(null)
  const asking = useAskAfterScroll()
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const row = scroller?.querySelector<HTMLElement>(ROW)
    if (scroller == null || row == null) return
    const listTop = scroller.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop)
    scroller.scrollTop += row.getBoundingClientRect().top - listTop + 16
  }, [])
  return <MessageList {...base} items={thread} main={false} actions={noopActions} confirmingDelete={asking ? thread[0]!.message.ts : undefined} scrollRef={scrollRef} />
}

/** A long report last, taller than its frame, as a feedback channel's newest message often is. */
const tallLast = messageWindow([
  { ago: 40, from: people.maya, text: 'Posting the weekly report below.' },
  { ago: 39, from: people.leo, text: 'Thanks.' },
  { ago: 30, from: people.jonas, blocks: Array.from({ length: 40 }, (_, index) => p(`Point ${index + 1} of the report: what changed this week and what we try next.`)) },
])

/**
 * The list at its end, as a topic opens, with a last message taller than the
 * list asking to confirm a delete: its top is under the band and its end on
 * the composer, so the confirm has room neither above nor below it and goes
 * inside, at the top in view.
 */
function TallLastRow() {
  const scrollRef = useRef<HTMLElement>(null)
  // The tall row lays out after the first scroll and grows the list: back to its end.
  const asking = useAskAfterScroll(() => {
    const scroller = scrollRef.current
    if (scroller != null) scroller.scrollTop = scroller.scrollHeight
  })
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller != null) scroller.scrollTop = scroller.scrollHeight
  }, [])
  return <MessageList {...base} items={tallLast} main={false} actions={noopActions} confirmingDelete={asking ? tallLast[tallLast.length - 1]!.message.ts : undefined} scrollRef={scrollRef} />
}

function ReactionChanges() {
  const chips = thread[CHIPPED]!.message.reactions
  const [step, setStep] = useState<'base' | 'joined' | 'counted' | 'first'>('base')
  useFixtureControl('chip-joins', () => setStep('joined'))
  useFixtureControl('count-up', () => setStep('counted'))
  useFixtureControl('chip-leaves', () => setStep('base'))
  useFixtureControl('first-chip', () => setStep('first'))
  const eyes = { name: 'eyes', count: 1, me: true, unicode: '👀' }
  const items =
    step === 'joined'
      ? withReactions(thread, CHIPPED, [...chips, eyes])
      : step === 'counted'
        ? withReactions(thread, CHIPPED, [...chips, { ...eyes, count: 2 }])
        : step === 'first'
          ? withReactions(thread, BARE, [eyes])
          : thread
  return <MessageList {...base} items={items} main={false} actions={noopActions} onToggleReaction={noop} />
}

/** The delete confirm shows at the row's top right and the edit field in the body's place, on the owner's command. */
function OwnRowChanges() {
  const [mode, setMode] = useState<'none' | 'confirm' | 'edit'>('none')
  useFixtureControl('confirm', () => setMode('confirm'))
  useFixtureControl('edit', () => setMode('edit'))
  useFixtureControl('done', () => setMode('none'))
  const own = sending[2]!.message.ts
  const items = sending.map((item) => (item.message.ts === own ? { ...item, message: { ...settledMessage, ts: own, id: own, groupStart: item.message.groupStart } } : item))
  return (
    <MessageList
      {...base}
      items={items}
      main={false}
      actions={noopActions}
      confirmingDelete={mode === 'confirm' ? own : undefined}
      editing={mode === 'edit' ? { ts: own, editor: <InlineEdit value="Shipping the fix today" onChange={noop} onSave={noop} onCancel={noop} /> } : undefined}
    />
  )
}

/** The `clientMsgId` of the uploading row, for its progress. */
const uploadingId = uploading[uploading.length - 1]!.message.clientMsgId!

/** The upload line appears, moves and goes under the pending row's files. The test checks that no row moves. */
function UploadProgress() {
  const [progress, setProgress] = useState<number | undefined>(undefined)
  useFixtureControl('start', () => setProgress(0.2))
  useFixtureControl('advance', () => setProgress(0.8))
  useFixtureControl('done', () => setProgress(undefined))
  return <MessageList {...base} items={uploading} main={false} uploadProgress={progress === undefined ? {} : { [uploadingId]: progress }} />
}

/** The cards gain their Download button. The test checks that no card changes height. */
function DownloadAppears() {
  const [download, setDownload] = useState(false)
  useFixtureControl('download', () => setDownload(true))
  return <MessageList {...base} items={withDownloads} main={false} {...(download ? { onDownload: noop } : {})} />
}

export default defineFixtures(
  MessageList,
  {
    Thread: {
      long: state({ items: thread, main: false }),
      // The window starts near the divider, as the container opens it, so the divider is in the frame.
      'new-divider': state({ items: thread.slice(6), main: false, dividerBefore: threadDividerBefore }),
      'mentions-you': state({ items: mentions, main: false }),
      'many-reactions': state({ items: manyReactions, main: false }),
      'loading-older': state({ items: thread, main: false, older: 'loading' }),
      'more-above': state({ items: thread, main: false, older: 'more' }),
    },
    Main: {
      // Real-data shapes in Main, where every row could get a thread link: the density check (message-geometry.spec.ts).
      conversation: state({ items: conversation, main: true, onToggleReaction: noop }),
      // The same rows in Comfortable density: a wider group gap and taller rows.
      'conversation-comfortable': state({ items: conversation, main: true, onToggleReaction: noop }, { density: 'comfortable' }),
      'thread-links': state({ items: mainStream, main: true }),
      'main-new-divider': state({ items: mainStream.slice(4), main: true, dividerBefore: mainDividerBefore }),
    },
    Content: {
      'right-to-left': state({ items: rtl, main: false }),
      'emoji-only': state({ items: emojiOnly, main: false }),
      hostile: state({ items: hostile, main: false }),
      // A long block inside the scrolling list: it scrolls inside its box and hands the wheel on at its edges.
      'long-code': state({ items: longCode, main: false }),
    },
    Files: {
      thumbnails: state({ items: withFiles, main: false }),
      'thumbnail-pending': state({ items: pendingFile, main: false }),
      'thumbnail-failed': state({ items: failedFile, main: false }),
      // Cards with Download, and thumbnails that open the viewer.
      downloads: state({ items: withDownloads, main: false, onDownload: noop, onOpenMedia: noop }),
      'focus-thumbnail': state({ items: withDownloads, main: false, onDownload: noop, onOpenMedia: noop }, { focus: '[data-thumbnail]' }),
    },
    Media: {
      // A message's pictures: two side by side, three with the first tall, four in 2 × 2, more as "+N" on the fourth.
      image: state({ items: singleImage, main: false, onOpenMedia: noop }),
      // A lone video: a player at its poster's box, with a button that opens it full screen.
      video: state({ items: singleVideo, main: false, onOpenMedia: noop }),
      // Pictures and a video in one message: one grid, the video's tile marked to play.
      mixed: state({ items: mixedMedia, main: false, onOpenMedia: noop }),
      'grid-2': state({ items: albumOf(2), main: false, onOpenMedia: noop }),
      'grid-3': state({ items: albumOf(3), main: false, onOpenMedia: noop }),
      'grid-4': state({ items: albumOf(4), main: false, onOpenMedia: noop }),
      'grid-6': state({ items: albumOf(6), main: false, onOpenMedia: noop }),
      // The pictures make the grid where the first is; the PDF keeps its card.
      'grid-and-pdf': state({ items: mediaAndPdf, main: false, onOpenMedia: noop, onDownload: noop }),
      // Cards the viewer opens, each with Download, and a zip with Quick Look.
      documents: state({ items: withDocuments, main: false, onOpenMedia: noop, onDownload: noop, onQuickLook: noop }),
      // A lone audio file: a player in its card.
      audio: state({ items: singleAudio, main: false, onOpenMedia: noop, onDownload: noop }),
      'focus-tile': state({ items: albumOf(6), main: false, onOpenMedia: noop }, { focus: '[data-thumbnail]' }),
    },
    Send: {
      sending: state({ items: sending, main: false }),
      failed: state({ items: failedSend, main: false, onRetry: noop, onDiscard: noop }),
      uploading: state({ items: uploading, main: false, uploadProgress: { [uploadingId]: 0.45 } }),
      'upload-failed': state({ items: uploadFailed, main: false, onRetry: noop, onDiscard: noop }),
    },
    Shift: {
      'pending-settles': scene(() => <PendingSettles />),
      'reaction-changes': scene(() => <ReactionChanges />),
      'own-row-changes': scene(() => <OwnRowChanges />),
      'upload-progress': scene(() => <UploadProgress />),
      'download-appears': scene(() => <DownloadAppears />),
    },
    Data: {
      'empty-thread': state({ items: [], main: false }),
      'empty-main': state({ items: [], main: true }),
      loading: state({ items: [], main: false, status: 'loading' }),
      offline: state({ items: [], main: false, status: 'offline' }),
    },
    Interaction: {
      hover: state({ items: thread, main: false }, { hover: `${ROW}:nth-of-type(4)` }),
      'hover-grouped': state({ items: thread, main: false }, { hover: `${ROW}:nth-of-type(6)` }),
      // Its menu is open: the row takes a faint fill.
      'menu-open': state({ items: thread, main: false, actions: noopActions, activeMessage: thread[3]!.message.ts }),
      // A delete waits for its confirm, which straddles the row's top edge above the first line: on a header row, on
      // a grouped row, and inside the first row at the list's top.
      'confirm-delete': state({ items: thread, main: false, actions: noopActions, confirmingDelete: thread[3]!.message.ts }),
      'confirm-delete-grouped': state({ items: thread, main: false, actions: noopActions, confirmingDelete: thread.find((item, i) => i > 0 && !item.message.groupStart)!.message.ts }),
      'confirm-delete-first': state({ items: thread, main: false, actions: noopActions, confirmingDelete: thread[0]!.message.ts }),
      // A row whose top is under the band: the confirm flips below it.
      'confirm-delete-under-band': scene(() => <ScrolledUnderBand />),
      // The last row is taller than the list and ends on the composer: the confirm goes inside it, under the band.
      'confirm-delete-tall-last': scene(() => <TallLastRow />),
      focus: state({ items: thread, main: false, actions: noopActions }, { focus: `${ROW}:last-of-type` }),
      'hover-thread-link': state({ items: mainStream, main: true }, { hover: '[data-thread-link]' }),
      // A sender's name, avatar and an @person chip open the DM: a quiet underline, a hairline ring, "Message Leo".
      'hover-person-name': scene(
        () => (
          <>
            <MessageList {...base} items={thread} main={false} onPerson={noop} />
            <TooltipLayer />
          </>
        ),
        { tooltip: `${ROW}:nth-of-type(4) [data-message-header] [data-opens-person]` },
      ),
      'hover-person-avatar': state({ items: thread, main: false, onPerson: noop }, { hover: `${ROW}:nth-of-type(4) [data-sender] [data-opens-person]` }),
      'hover-person-chip': state({ items: thread, main: false, onPerson: noop }, { hover: `${ROW} [data-msg-text] [data-opens-person]` }),
      // The tabbable row's link: the shot tabs back and forth, and only that row's link is in the Tab order.
      'focus-thread-link': state({ items: mainStream, main: true }, { focus: '[data-message-row][tabindex="0"] [data-thread-link]' }),
    },
    // A 336px column, a topic in the 720px window: the confirm straddles the row's top edge as in a wide one.
    Narrow: {
      hover: state({ items: thread, main: false, actions: noopActions }, { width: 336, height: 600, padded: false, hover: `${ROW}:nth-of-type(4)` }),
      'confirm-delete': state({ items: thread, main: false, actions: noopActions, confirmingDelete: thread[3]!.message.ts }, { width: 336, height: 600, padded: false }),
      'focus-top': state({ items: thread, main: false, actions: noopActions }, { width: 336, height: 600, padded: false, focus: ROW }),
    },
  },
  { width: 816, height: 600, padded: false },
)
