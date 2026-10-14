import { defineFixtures, fixture, hueForId, type FixtureFrame } from '@juno/ui'
import { hostile, longFirstLine, main, mentions, thread } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { HoverToolbar } from './HoverToolbar'
import { Message, type MessageProps } from './Message'
import type { MessageListItem } from './MessageList'
import { messageTime } from './time'

const noop = () => {}

const one = (item: MessageListItem, extra: Partial<MessageProps> = {}, frame?: FixtureFrame) =>
  fixture<MessageProps>(
    {
      message: item.message,
      sender: item.sender,
      time: messageTime(item.message.at, NOW),
      now: NOW,
      main: false,
      startsGroup: false,
      flush: true,
      tabbable: true,
      hueOf: hueForId,
      onOpenThread: noop,
      onChannel: noop,
      onLink: noop,
      ...extra,
    },
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
    Interaction: {
      hover: one(first, {}, { hover: '[data-message-row]' }),
      'hover-continuation': one(grouped, {}, { hover: '[data-message-row]' }),
      'hover-toolbar': one(first, { toolbar: <HoverToolbar /> }, { hover: '[data-message-row]' }),
      'hover-toolbar-main': one(withThread, { main: true, toolbar: <HoverToolbar main /> }, { hover: '[data-message-row]' }),
      // The header keeps the toolbar's footprint free, so the name and the first body line stay clear of it.
      'hover-toolbar-long-line': one(longLine, { startsGroup: true, toolbar: <HoverToolbar main /> }, { hover: '[data-message-row]' }),
      'hover-toolbar-continuation': one(longLineContinuation, { toolbar: <HoverToolbar main /> }, { hover: '[data-message-row]' }),
      focus: one(first, { toolbar: <HoverToolbar /> }, { focus: '[data-message-row]' }),
    },
  },
  { width: 640 },
)
