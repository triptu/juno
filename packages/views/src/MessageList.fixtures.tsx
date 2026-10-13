import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
import { emojiOnly, failedFile, hostile, main as mainStream, mainDividerBefore, manyReactions, mentions, pendingFile, rtl, thread, threadDividerBefore, withFiles } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { HoverToolbar } from './HoverToolbar'
import { MessageList, type MessageListProps } from './MessageList'

const noop = () => {}

const base: Pick<MessageListProps, 'now' | 'onOpenThread' | 'onChannel' | 'onLink'> = { now: NOW, onOpenThread: noop, onChannel: noop, onLink: noop }

const state = (props: Partial<MessageListProps> & Pick<MessageListProps, 'items' | 'main'>, frame?: FixtureFrame) => fixture<MessageListProps>({ ...base, ...props }, frame)

const ROW = '[data-message-row]'
const toolbar = (main: boolean) => () => <HoverToolbar main={main} />

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
    },
    Files: {
      thumbnails: state({ items: withFiles, main: false }),
      'thumbnail-pending': state({ items: pendingFile, main: false }),
      'thumbnail-failed': state({ items: failedFile, main: false }),
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
      'hover-toolbar': state({ items: thread, main: false, renderToolbar: toolbar(false) }, { hover: `${ROW}:nth-of-type(4)` }),
      'hover-toolbar-main': state({ items: mainStream, main: true, renderToolbar: toolbar(true) }, { hover: `${ROW}:nth-of-type(5)` }),
      focus: state({ items: thread, main: false, renderToolbar: toolbar(false) }, { focus: `${ROW}:last-of-type` }),
      'hover-thread-link': state({ items: mainStream, main: true }, { hover: '[data-thread-link]' }),
      'focus-thread-link': state({ items: mainStream, main: true }, { focus: '[data-thread-link]' }),
    },
  },
  { width: 816, height: 600, padded: false },
)
