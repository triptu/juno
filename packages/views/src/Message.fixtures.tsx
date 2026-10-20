import * as stylex from '@stylexjs/stylex'
import { layout } from '@juno/tokens/tokens.stylex'
import { defineFixtures, hueForId, scene, type Fixture, type FixtureFrame } from '@juno/ui'
import { codeBlocks, failedSend, hostile, longFirstLine, main, mentions, sending, thread } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { noopActions } from './fixtures/actions'
import { InlineEdit } from './InlineEdit'
import { Message, type MessageProps } from './Message'
import type { MessageListItem } from './MessageList'
import { messageTime } from './time'

const noop = () => {}

// The frame sizes a lone component to its content; the list column sizes a
// row to its width, so the row fills the frame as it would the column. The
// toolbar and the delete confirm straddle the row's top edge, so the frame
// keeps their height above the row, as the row before does in a list.
const column = stylex.create({ fill: { width: '100%', paddingTop: layout['--toolbar-height'] } })

const one = (item: MessageListItem, extra: Partial<MessageProps> = {}, frame?: FixtureFrame): Fixture<MessageProps> =>
  scene(
    () => (
      <div {...stylex.props(column.fill)}>
        <Message
          message={item.message}
          sender={item.sender}
          time={messageTime(item.message.at, NOW)}
          now={NOW}
          main={false}
          startsGroup={false}
          flush
          tabbable
          hueOf={hueForId}
          onOpenThread={noop}
          onChannel={noop}
          onLink={noop}
          {...extra}
        />
      </div>
    ),
    frame,
  )

const first = thread[0]!
const grouped = thread[4]!
const mention = mentions[2]!
const withThread = main[4]!
const deleted = hostile[3]!
const unloaded = hostile[4]!
const edited = thread[9]!
const broadcast = main[8]!
const longLine = longFirstLine[0]!
const longLineContinuation = longFirstLine[1]!
const pendingRow = sending[2]!
const failedRow = failedSend[2]!
// Your own message as Slack stored it: the sending fixture, settled.
const { pending: _pending, ...ownStored } = pendingRow.message
const ownText = 'Postgres 16 is on staging. I will move prod on Thursday.'
const ownMessage: MessageListItem = { ...pendingRow, message: { ...ownStored, editText: ownText } }
// A reaction Slack refused (the chip shows what Slack has) and one that has not gone out for a while.
const reactionRefused: MessageListItem = { ...first, message: { ...first.message, reactionIssue: { id: 1, key: 'refused', name: 'shipit', on: true, state: 'failed' } } }
const reactionWaiting: MessageListItem = { ...first, message: { ...first.message, reactionIssue: { id: 2, key: 'waiting', name: '+1', on: true, state: 'waiting' } } }

export default defineFixtures(
  Message,
  {
    Row: {
      'group-start': one(first),
      continuation: one(grouped),
      'mentions-you': one(mention),
      edited: one(edited),
      broadcast: one(broadcast, { startsGroup: true }),
      'thread-link': one(withThread, { main: true }),
      deleted: one(deleted),
      unloaded: one(unloaded),
      // The name is cut off: hovering it shows the full name as the tooltip.
      'long-name': one(longLine, { startsGroup: true }, { width: 420 }),
    },
    // Code blocks: tagged (the tag line is not shown), detected, a stack trace left plain, and a long one.
    Code: {
      'code-blocks': one(codeBlocks[0]!, { startsGroup: true }),
    },
    // A send still on its way looks like the message it becomes; past --delay-pending it dims.
    Send: {
      sending: one(pendingRow, { startsGroup: true }),
      failed: one(failedRow, { startsGroup: true, onRetry: noop, onDiscard: noop }),
      'failed-continuation': one(failedRow, { onRetry: noop, onDiscard: noop }),
    },
    Action: {
      'edit-failed': one({ ...ownMessage, message: { ...ownMessage.message, actionIssue: { id: 1, kind: 'edit' } } }, { startsGroup: true, actions: { ...noopActions, onResolveAction: noop } }),
      'delete-failed': one({ ...ownMessage, message: { ...ownMessage.message, actionIssue: { id: 2, kind: 'delete' } } }, { startsGroup: true, actions: { ...noopActions, onResolveAction: noop } }),
    },
    // The user's reaction Slack did not take: refused, with Retry and Dismiss, or not sent for a while.
    Reaction: {
      refused: one(reactionRefused, { startsGroup: true, actions: { ...noopActions, onResolveAction: noop } }),
      waiting: one(reactionWaiting, { startsGroup: true }),
    },
    Interaction: {
      hover: one(first, {}, { hover: '[data-message-row]' }),
      'hover-continuation': one(grouped, {}, { hover: '[data-message-row]' }),
      'hover-toolbar': one(first, { actions: noopActions }, { hover: '[data-message-row]' }),
      'hover-toolbar-main': one(withThread, { main: true, actions: noopActions }, { hover: '[data-message-row]' }),
      // The header keeps the toolbar's footprint free, so the name and the first body line stay clear of it.
      'hover-toolbar-long-line': one(longLine, { startsGroup: true, actions: noopActions }, { hover: '[data-message-row]' }),
      'hover-toolbar-continuation': one(longLineContinuation, { actions: noopActions }, { hover: '[data-message-row]' }),
      focus: one(first, { actions: noopActions }, { focus: '[data-message-row]' }),
    },
    // Your own message: the delete confirm in the toolbar's place, and the inline edit field in the body's.
    Own: {
      'confirm-delete': one(ownMessage, { startsGroup: true, actions: noopActions, confirmingDelete: true }),
      'confirm-delete-continuation': one(ownMessage, { actions: noopActions, confirmingDelete: true }),
      editing: one(ownMessage, { startsGroup: true, actions: noopActions, editor: <InlineEdit value={ownText} onChange={noop} onSave={noop} onCancel={noop} /> }),
      'editing-long': one(ownMessage, {
        startsGroup: true,
        actions: noopActions,
        editor: <InlineEdit value={`${ownText}\n\nAlso: the staging bill doubled since August, so the migration plan has to land before the next billing cycle closes.`} onChange={noop} onSave={noop} onCancel={noop} />,
      }),
      'editing-empty': one(ownMessage, { startsGroup: true, actions: noopActions, editor: <InlineEdit value="" onChange={noop} onSave={noop} onCancel={noop} /> }),
    },
  },
  { width: 640 },
)
