import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import type { TopicDetail } from '@juno/contract'
import { ActiveThreads } from './ActiveThreads'
import { ComposerSlot } from './ComposerSlot'
import { details, emojiOnly, engThreads, hostile, main, mainDividerBefore, mentions, rtl, thread, threadDividerBefore, withFiles } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { HoverToolbar } from './HoverToolbar'
import { MessageList, type MessageListProps } from './MessageList'
import { NewMessagesPill } from './NewMessagesPill'
import { TopicHeader, type TopicHeaderProps } from './TopicHeader'
import { TopicView, type TopicViewProps } from './TopicView'

const noop = () => {}

interface Scene {
  readonly detail: TopicDetail
  readonly items: MessageListProps['items']
  readonly header?: Partial<TopicHeaderProps>
  readonly list?: Partial<MessageListProps>
  readonly pill?: number
}

const placeholder = (detail: TopicDetail) => (detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply')

const topic = ({ detail, items, header, list, pill }: Scene, frame?: FixtureFrame) =>
  scene<TopicViewProps>(
    () => (
      <TopicView
        header={<TopicHeader detail={detail} onRename={noop} {...(detail.kind === 'main' ? { onThreads: noop } : {})} {...header} />}
        pill={pill === undefined ? undefined : <NewMessagesPill count={pill} onJump={noop} />}
        composer={<ComposerSlot placeholder={placeholder(detail)} />}
      >
        <MessageList items={items} main={detail.kind === 'main'} now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} {...list} />
      </TopicView>
    ),
    frame,
  )

const threads = <ActiveThreads threads={engThreads} now={NOW} onOpen={noop} />

export default defineFixtures(
  TopicView,
  {
    Thread: {
      'long-thread': topic({ detail: details.postgres, items: thread }),
      // The window starts near the divider, as the container opens it, so the divider is in the frame.
      'new-divider': topic({ detail: details.postgres, items: thread.slice(6), list: { dividerBefore: threadDividerBefore } }),
      'mentions-you': topic({ detail: details.hiring, items: mentions }),
      'scrolled-up': topic({ detail: details.postgres, items: thread, pill: 2 }),
      'jump-to-latest': topic({ detail: details.postgres, items: thread, pill: 0 }),
    },
    Main: {
      'channel-main': topic({ detail: details.engMain, items: main.slice(4), list: { dividerBefore: mainDividerBefore } }),
      'threads-open': topic({ detail: details.engMain, items: main, header: { threadsOpen: true, threads } }),
    },
    Content: {
      'right-to-left': topic({ detail: details.mohammed, items: rtl }),
      'emoji-only': topic({ detail: details.unicorn, items: emojiOnly }),
      files: topic({ detail: details.postgres, items: withFiles }),
      hostile: topic({ detail: details.long, items: hostile }),
    },
    Data: {
      empty: topic({ detail: details.offsite, items: [] }),
      loading: topic({ detail: details.postgres, items: [], list: { status: 'loading' } }),
      offline: topic({ detail: details.flags, items: [], list: { status: 'offline' } }),
    },
    Interaction: {
      'hover-message': topic({ detail: details.postgres, items: thread, list: { renderToolbar: () => <HoverToolbar /> } }, { hover: '[data-message-row]:nth-of-type(3)' }),
      'minimum-window': topic({ detail: details.engMain, items: main, list: { dividerBefore: mainDividerBefore } }, { width: 720, height: 480 }),
    },
  },
  { width: 900, height: 640, padded: false },
)
