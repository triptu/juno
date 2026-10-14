import { useLayoutEffect, useRef, useState } from 'react'
import { Button, defineFixtures, scene, type FixtureFrame } from '@juno/ui'
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
  /** Scroll the list this far down before the first paint, as a restored position would. */
  readonly scrollTop?: number
}

const placeholder = (detail: TopicDetail) => (detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply')

function Topic({ detail, items, header, list, pill, scrollTop }: Scene) {
  const scrollRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (scrollTop !== undefined && scrollRef.current !== null) scrollRef.current.scrollTop = scrollTop
  }, [scrollTop])
  return (
    <TopicView
      header={
        <TopicHeader
          detail={detail}
          onMenu={noop}
          onPill={noop}
          juno={{ open: false, onToggle: noop }}
          {...(detail.kind === 'main' ? { onThreads: noop } : { onResolve: noop })}
          {...header}
        />
      }
      pill={pill === undefined ? undefined : <NewMessagesPill count={pill} onJump={noop} />}
      composer={<ComposerSlot placeholder={placeholder(detail)} />}
    >
      <MessageList items={items} main={detail.kind === 'main'} now={NOW} scrollRef={scrollRef} onOpenThread={noop} onChannel={noop} onLink={noop} {...list} />
    </TopicView>
  )
}

/**
 * Every header change the owner can make in place: the menu opening, Juno
 * pressed, a rename, resolving, and the title or the channel going long.
 * The header is out of flow, so none of them may move a message.
 */
const headerSteps: ReadonlyArray<Partial<Scene>> = [
  {},
  { header: { menuOpen: true } },
  { header: { juno: { open: true, onToggle: noop } } },
  { detail: { ...details.postgres, title: 'Postgres 16 cutover window' } },
  { detail: { ...details.postgres, resolved: true, status: 'resolved' } },
  { detail: details.long },
]

function HeaderCycles() {
  const [step, setStep] = useState(0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        <Topic detail={details.postgres} items={thread} scrollTop={260} {...headerSteps[step]} />
      </div>
      <Button variant="secondary" size="sm" onClick={() => setStep((n) => (n + 1) % headerSteps.length)}>
        Next header
      </Button>
    </div>
  )
}

const topic = (props: Scene, frame?: FixtureFrame) => scene<TopicViewProps>(() => <Topic {...props} />, frame)

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
    // The list runs under the islands: at the top the inset keeps the first message clear of the band; scrolled, text fades out under it.
    Header: {
      'thread-at-top': topic({ detail: details.postgres, items: thread }),
      'thread-scrolled': topic({ detail: details.postgres, items: thread, scrollTop: 260 }),
      'main-scrolled': topic({ detail: details.engMain, items: main, scrollTop: 200 }),
      'direct-message-scrolled': topic({ detail: details.offsite, items: thread, scrollTop: 260 }),
      'menu-open': topic({ detail: details.postgres, items: thread, header: { menuOpen: true }, scrollTop: 260 }),
      'narrow-thread': topic({ detail: details.hiring, items: thread, scrollTop: 260 }, { width: 336, height: 480 }),
      'narrow-main': topic({ detail: details.engMain, items: main, scrollTop: 200 }, { width: 336, height: 480 }),
    },
    Shift: {
      'header-cycles': scene(() => <HeaderCycles />),
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
