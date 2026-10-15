import { useState } from 'react'
import type { MessageView } from '@juno/contract'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { emojiOnly, failedFile, failedSend, hostile, longCode, longFirstLine, main as mainStream, mainDividerBefore, manyReactions, mentions, pendingFile, rtl, sending, thread, threadDividerBefore, withFiles } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { noopActions } from './fixtures/actions'
import { InlineEdit } from './InlineEdit'
import { MessageList, type MessageListItem, type MessageListProps } from './MessageList'

const noop = () => {}

const base: Pick<MessageListProps, 'now' | 'onOpenThread' | 'onChannel' | 'onLink'> = { now: NOW, onOpenThread: noop, onChannel: noop, onLink: noop }

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

/** The delete confirm takes the toolbar's place and the edit field the body's, on the owner's command. */
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
    },
    Send: {
      sending: state({ items: sending, main: false }),
      failed: state({ items: failedSend, main: false, onRetry: noop, onDiscard: noop }),
    },
    Shift: {
      'pending-settles': scene(() => <PendingSettles />),
      'reaction-changes': scene(() => <ReactionChanges />),
      'own-row-changes': scene(() => <OwnRowChanges />),
    },
    Data: {
      'empty-thread': state({ items: [], main: false }),
      'empty-main': state({ items: [], main: true }),
      loading: state({ items: [], main: false, status: 'loading' }),
      offline: state({ items: [], main: false, status: 'offline' }),
    },
    Interaction: {
      hover: state({ items: thread, main: false }, { hover: `${ROW}:nth-of-type(4)` }),
      'hover-grouped': state({ items: thread, main: false }, { hover: `${ROW}:nth-of-type(5)` }),
      'hover-toolbar': state({ items: thread, main: false, actions: noopActions }, { hover: `${ROW}:nth-of-type(4)` }),
      'hover-toolbar-main': state({ items: mainStream, main: true, actions: noopActions }, { hover: `${ROW}:nth-of-type(5)` }),
      'hover-toolbar-long-line': state({ items: longFirstLine, main: true, actions: noopActions }, { hover: `${ROW}:first-of-type` }),
      focus: state({ items: thread, main: false, actions: noopActions }, { focus: `${ROW}:last-of-type` }),
      'hover-thread-link': state({ items: mainStream, main: true }, { hover: '[data-thread-link]' }),
      'focus-thread-link': state({ items: mainStream, main: true }, { focus: '[data-thread-link]' }),
    },
    // A 336px column, a topic in the 720px window: the toolbar rises above a row,
    // except near the list's top, where it drops inside under the name line.
    Narrow: {
      'hover-toolbar': state({ items: thread, main: false, actions: noopActions }, { width: 336, height: 600, padded: false, hover: `${ROW}:nth-of-type(4)` }),
      'hover-toolbar-top': state({ items: thread, main: false, actions: noopActions }, { width: 336, height: 600, padded: false, hover: `${ROW}:first-of-type` }),
      'focus-top': state({ items: thread, main: false, actions: noopActions }, { width: 336, height: 600, padded: false, focus: `${ROW}:first-of-type` }),
    },
  },
  { width: 816, height: 600, padded: false },
)
