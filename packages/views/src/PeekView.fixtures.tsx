import { useEffect, useState } from 'react'
import { defineFixtures, scene, TopicArt } from '@juno/ui'
import type { TopicDetail } from '@juno/contract'
import { ComposerSlot } from './ComposerSlot'
import { details, main, reaction, thread, window as messages } from './fixtures/messages'
import { NOW, people, rows } from './fixtures/topics'
import { MessageList, type MessageListProps } from './MessageList'
import { PeekView, type PeekPlacement, type PeekViewProps } from './PeekView'
import { SignedIn } from './Shell.fixtures'
import { TopicHeader } from './TopicHeader'
import { TopicView } from './TopicView'

const noop = () => {}

const HOUR_IN_MINUTES = 60

/** The staging bill thread from `main`: the root and its 2 replies, a short peek. */
const stagingThread = messages([
  { ago: 2 * HOUR_IN_MINUTES + 2, from: people.leo, root: true, text: 'Unrelated: has anyone looked at the staging bill? It doubled since August.' },
  { ago: 70, from: people.dev, text: 'The preview environments never shut down. 41 of them are still up from the summer.' },
  { ago: 50, from: people.leo, text: 'Ouch. Can we put a 3 day expiry on them?', reactions: [reaction('+1', '👍', 2)] },
])

const staging: TopicDetail = {
  ...details.postgres,
  id: 'C0ENG:1759993200.000100',
  title: 'Staging bill doubled since August',
  messageCount: 3,
  unreadCount: 0,
  mentionsMe: false,
  rootTs: stagingThread[0]?.message.ts ?? '',
  lastActivityTs: stagingThread.at(-1)?.message.ts ?? '',
}

interface Peek {
  readonly detail: TopicDetail
  readonly items: MessageListProps['items']
  readonly status?: MessageListProps['status']
  readonly placement?: PeekPlacement
}

/** The peek as the container draws it: no actions on the messages, the popover's list. */
function PeekOf({ detail, items, status, placement }: Peek) {
  return (
    <PeekView
      title={detail.kind === 'main' ? detail.channel.label : detail.title}
      {...(detail.kind === 'main' ? {} : { where: detail.channel.label })}
      art={<TopicArt topicId={detail.id} recipe={detail.art} size={20} />}
      {...(placement === undefined ? {} : { placement })}
    >
      <MessageList items={items} main={detail.kind === 'main'} now={NOW} underHeader={false} popover {...(status === undefined ? {} : { status })} />
    </PeekView>
  )
}

/** The window with the sidebar, and the peek beside it. */
const peek = (input: Peek & { readonly width?: number }, frame?: Parameters<typeof scene>[1]) =>
  scene<PeekViewProps>(() => <SignedIn {...(input.width === undefined ? {} : { width: input.width })} peek={<PeekOf {...input} />} />, frame)

/** #eng Main in the workspace, as a tab shows it. */
function EngMain() {
  return (
    <TopicView
      header={<TopicHeader detail={details.engMain} onMenu={noop} onPill={noop} juno={{ open: false, onToggle: noop }} />}
      composer={<ComposerSlot placeholder="Message #eng" />}
    >
      <MessageList items={main} main now={NOW} onOpenThread={noop} onChannel={noop} onLink={noop} />
    </TopicView>
  )
}

/**
 * The peek at a Main message's thread, placed as `Peek.tsx` places it:
 * measured when the pointer comes onto the message, as the app measures
 * when the key goes down over it.
 */
function ThreadPeek({ thread: id, ...input }: Omit<Peek, 'placement'> & { readonly thread: string }) {
  const [placement, setPlacement] = useState<PeekPlacement | undefined>(undefined)
  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      const message = event.target instanceof Element ? event.target.closest(`[data-thread="${id}"]`) : null
      const frame = message?.closest('[data-fixture-frame]')?.getBoundingClientRect()
      const box = message?.getBoundingClientRect()
      if (box === undefined || frame === undefined) return
      // The frame stands in for the window: its top and bottom, not the gallery page's.
      const below = frame.bottom - box.bottom
      const at = below >= 320 || below >= box.top - frame.top ? 'below' : 'above'
      const y = Math.round(at === 'below' ? box.bottom : box.top)
      setPlacement({ at, x: Math.round(box.left), y, room: at === 'below' ? Math.round(frame.bottom) - y : y - Math.round(frame.top) })
    }
    document.addEventListener('pointerover', onPointerOver)
    return () => document.removeEventListener('pointerover', onPointerOver)
  }, [id])
  return placement === undefined ? null : <PeekOf {...input} placement={placement} />
}

const threadPeek = (input: Omit<Peek, 'placement'> & { readonly thread: string }) =>
  scene<PeekViewProps>(() => <SignedIn page={<EngMain />} peek={<ThreadPeek {...input} />} />, { hover: `[data-thread="${input.thread}"]` })

const overRow = (id: string) => ({ hover: `[data-topic-id="${id}"]` })

export default defineFixtures(
  PeekView,
  {
    Size: {
      short: peek({ detail: staging, items: stagingThread }, overRow(rows.postgres.id)),
      long: peek({ detail: details.postgres, items: thread }, overRow(rows.postgres.id)),
    },
    Topic: {
      'channel-main': peek({ detail: details.engMain, items: main }, overRow(rows.postgres.id)),
    },
    Thread: {
      'short-thread': threadPeek({ detail: staging, items: stagingThread, thread: staging.id }),
      'long-thread': threadPeek({ detail: details.postgres, items: thread, thread: details.postgres.id }),
    },
    Data: {
      loading: peek({ detail: details.postgres, items: [], status: 'loading' }, overRow(rows.postgres.id)),
      empty: peek({ detail: details.offsite, items: [] }, overRow(rows.offsite.id)),
    },
    Window: {
      'minimum-window': peek({ detail: details.postgres, items: thread, width: 280 }, { width: 720, height: 480, ...overRow(rows.postgres.id) }),
      'widest-sidebar': peek({ detail: details.postgres, items: thread, width: 480 }, { width: 1000, height: 720, ...overRow(rows.postgres.id) }),
    },
  },
  { width: 1200, height: 720, padded: false },
)
