import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import type { TopicDetail } from '@juno/contract'
import { TopicSwitcher } from './TopicSwitcher'
import { ComposerSlot } from './ComposerSlot'
import { details, emojiOnly, me, message, engTopics, hostile, main, mainDividerBefore, mentions, rtl, thread, threadDividerBefore, withFiles } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import type { EmojiCategory } from '@juno/contract'
import { EmojiPicker } from './EmojiPicker'
import { noopActions } from './fixtures/actions'
import { Floating, SelectionQuote } from './Floating'
import { MessageList, type MessageListProps } from './MessageList'
import { NewMessagesPill } from './NewMessagesPill'
import { TopicHeader, type TopicHeaderProps } from './TopicHeader'
import { TopicView, type TopicViewProps } from './TopicView'

const noop = () => {}

/** The end of `thread` with a lowercase reply just sent, holding one slip the post-send check finds. */
const sentSlip = [
  ...thread.slice(10),
  message({ ago: 0, from: me, text: "dry run passed on staging, replica lag stayed under 2s the whole time. its ready for thursday, i'll post the runbook diff after lunch" }, thread.at(-1)),
]
const slip = new Map([[sentSlip.at(-1)!.message.ts, { label: "its → it's", onReview: noop, onDismiss: noop }]])
/** Two fixes: the count, then the fixes in muted text. */
const slips = new Map([[sentSlip.at(-1)!.message.ts, { label: '2 small fixes', detail: "its → it's, the the → the", onReview: noop, onDismiss: noop }]])

interface Scene {
  readonly detail: TopicDetail
  readonly items: MessageListProps['items']
  readonly header?: Partial<TopicHeaderProps>
  readonly list?: Partial<MessageListProps>
  readonly pill?: number
  /** Scroll the list this far down before the first paint, as a restored position would. */
  readonly scrollTop?: number
  readonly floating?: TopicViewProps['floating']
}

const placeholder = (detail: TopicDetail) => (detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply')

function Topic({ detail, items, header, list, pill, scrollTop, floating }: Scene) {
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
      floating={floating}
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

const switcher = {
  open: true,
  onOpen: noop,
  content: <TopicSwitcher mainId="C0ENG:main" mainUnread={3} currentId="C0ENG:main" threads={engTopics} now={NOW} query="" onQuery={noop} onOpen={noop} />,
}

/** A few emoji, so the picker reads like the real one without the whole catalog. */
const pickerCatalog: ReadonlyArray<EmojiCategory> = [
  {
    name: 'Smileys & emotion',
    emoji: ['😀 grinning', '😃 smiley', '😄 smile', '😁 grin', '😆 laughing', '😅 sweat_smile', '🤣 rolling_on_the_floor_laughing', '😂 joy', '🙂 slightly_smiling_face', '😉 wink', '😊 blush', '😇 innocent'].map((pair) => {
      const [unicode, name] = pair.split(' ') as [string, string]
      return { name, unicode }
    }),
  },
  {
    name: 'People & body',
    emoji: ['👍 +1', '👎 -1', '👏 clap', '🙌 raised_hands', '🙏 pray', '💪 muscle', '👀 eyes', '🧠 brain', '👋 wave'].map((pair) => {
      const [unicode, name] = pair.split(' ') as [string, string]
      return { name, unicode }
    }),
  },
]

/**
 * Text selected in a message shows the floating Quote button centred over
 * the selection. The scene selects a message's text the way a drag would
 * and places the button from the selection's box, as the container does.
 */
function SelectionScene() {
  const [at, setAt] = useState<{ x: number; y: number } | undefined>(undefined)
  useEffect(() => {
    // Once the fonts are in and the list has drawn, as a drag would end on a settled list.
    let frame = 0
    let live = true
    void document.fonts.ready.then(() => {
      if (live) frame = requestAnimationFrame(select)
    })
    const select = () => {
      const text = document.querySelectorAll('[data-message-row] [data-msg-text] p')[2]
      const middle = text?.closest('[data-topic-middle]')
      if (text == null || middle == null || text.firstChild === null) return
      const range = document.createRange()
      range.setStart(text.firstChild, 0)
      range.setEnd(text.firstChild, Math.min(40, text.firstChild.textContent?.length ?? 0))
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const box = range.getBoundingClientRect()
      const origin = middle.getBoundingClientRect()
      setAt({ x: box.left + box.width / 2 - origin.left, y: box.top - origin.top })
    }
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [])
  return (
    <Topic
      detail={details.postgres}
      items={thread}
      list={{ actions: noopActions }}
      floating={at === undefined ? undefined : (
        <Floating x={at.x} y={at.y} placement="above-center" layer="selection">
          <SelectionQuote onQuote={noop} />
        </Floating>
      )}
    />
  )
}

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
      'switcher-open': topic({ detail: details.engMain, items: main, header: { switcher } }),
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
      'hover-message': topic({ detail: details.postgres, items: thread, list: { actions: noopActions } }, { hover: '[data-message-row]:nth-of-type(3)' }),
      'selection-quote': scene(() => <SelectionScene />),
      // More reactions opens the picker under the toolbar, floated over the list so the row's paint containment does not clip it.
      'emoji-picker': topic({
        detail: details.postgres,
        items: thread,
        list: { actions: noopActions },
        floating: (
          <Floating x={820} y={180} placement="below-end" layer="picker">
            <EmojiPicker catalog={pickerCatalog} recent={['+1', 'white_check_mark', 'eyes']} onPick={noop} onClose={noop} />
          </Floating>
        ),
      }),
      // After sending: the fix line under the sent message, until Review or Dismiss.
      'sent-suggestion': topic({ detail: details.postgres, items: sentSlip, list: { suggestions: slip } }),
      'sent-suggestions': topic({ detail: details.postgres, items: sentSlip, list: { suggestions: slips } }),
      'sent-suggestion-narrow': topic({ detail: details.postgres, items: sentSlip, list: { suggestions: slips } }, { width: 400, height: 640 }),
      'minimum-window': topic({ detail: details.engMain, items: main, list: { dividerBefore: mainDividerBefore } }, { width: 720, height: 480 }),
    },
  },
  { width: 900, height: 640, padded: false },
)
