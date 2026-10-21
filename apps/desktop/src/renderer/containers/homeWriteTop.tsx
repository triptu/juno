import { useState } from 'react'
import type { PickConversation, ThreadSummary } from '@juno/contract'
import { homeDraftAtom, homeThreadsAtom, nowAtom, pickConversationsAtom, pickThread, registry, setHomeDraft, type HomeDraft, type HomeThread } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { DestinationChip, HomeWriteTop, TopicChip } from '@juno/views'
import type { useDestination } from './HomeComposer'
import { useHeld } from './pickerRows'

export interface WriteTopProps {
  readonly tabId: string
  readonly draft: HomeDraft
  readonly junoOn: boolean
  readonly destination: ReturnType<typeof useDestination>
  readonly focusField: () => void
  /** A key typed on a closed chip: it goes into the field. */
  readonly onType: (text: string) => void
}

/**
 * The row above Home's field (SPEC section 12, "Writing"): the destination
 * chip and, while a person or channel is chosen, the topic chip.
 */
export function WriteTop({ tabId, draft, junoOn, destination, focusField, onType }: WriteTopProps) {
  const topic = useTopic(tabId, focusField)
  return (
    <HomeWriteTop
      chip={<Chip destination={draft.conversation} junoOn={junoOn} onType={onType} {...destination.chip} />}
      topic={draft.conversation === undefined ? undefined : <Topic conversation={draft.conversation} thread={draft.thread} onType={onType} {...topic} />}
    />
  )
}

/** The thread a send replies in, and the topic chip's list: choosing one, or Main, puts focus back in the field. */
function useTopic(tabId: string, focusField: () => void) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const choose = (thread: ThreadSummary | undefined) => {
    const chosen: HomeThread | undefined = thread === undefined ? undefined : { id: thread.id, rootTs: thread.rootTs, title: thread.title, ...(thread.art === undefined ? {} : { art: thread.art }) }
    setHomeDraft(registry, tabId, pickThread(registry.get(homeDraftAtom(tabId)), chosen))
    setOpen(false)
    setQuery('')
    focusField()
  }
  const onOpen = (next: boolean) => {
    setQuery('')
    setOpen(next)
    if (!next) focusField()
  }
  return { open, query, onQuery: setQuery, onOpen, onPick: choose }
}

interface TopicProps {
  readonly conversation: PickConversation | undefined
  readonly thread: HomeThread | undefined
  readonly open: boolean
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly onOpen: (open: boolean) => void
  readonly onPick: (thread: ThreadSummary | undefined) => void
  readonly onType: (text: string) => void
}

/** No threads: a person never messaged has no conversation yet. */
const NO_THREADS: ReadonlyArray<ThreadSummary> = []

/**
 * The topic chip, with the conversation's threads. They are read once the
 * pointer or focus reaches the chip (the topic switcher's local query, so
 * the two share it), never at Home's first paint, and the list opens with
 * its rows.
 */
function Topic({ conversation, thread, open, query, onQuery, onOpen, onPick, onType }: TopicProps) {
  const channel = conversation?.channelId
  const [warm, setWarm] = useState<string | undefined>(undefined)
  const reading = channel !== undefined && (open || warm === channel)
  const result = useAtomValue(homeThreadsAtom(reading ? channel : undefined))
  const now = useAtomValue(nowAtom)
  const window = result._tag === 'Success' ? result.value : undefined
  const threads = conversation !== undefined && channel === undefined ? NO_THREADS : window === undefined ? undefined : window.order.map((id) => window.rows.get(id)!)
  return (
    <TopicChip
      conversation={conversation}
      thread={thread}
      open={open}
      onOpen={onOpen}
      query={query}
      onQuery={onQuery}
      threads={threads}
      now={now}
      onPick={onPick}
      onWarm={() => setWarm(channel)}
      onType={onType}
    />
  )
}

interface ChipProps {
  readonly destination: PickConversation | undefined
  readonly junoOn: boolean
  readonly open: boolean
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly onOpen: (open: boolean) => void
  readonly onPick: (conversation: PickConversation | undefined) => void
  readonly onType: (text: string) => void
}

/** The destination chip, with its list's live query while it is open. */
function Chip({ destination, junoOn, open, query, onQuery, onOpen, onPick, onType }: ChipProps) {
  const list = useAtomValue(pickConversationsAtom(open ? query : undefined))
  const conversations = useHeld(list._tag === 'Success' ? list.value : undefined, open)
  return <DestinationChip destination={destination} juno={junoOn} open={open} onOpen={onOpen} query={query} onQuery={onQuery} conversations={conversations.value} loading={conversations.loading} onPick={onPick} onType={onType} />
}

