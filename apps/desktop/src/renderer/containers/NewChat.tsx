import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { encodeMentions, type PickConversation, type PickThread } from '@juno/contract'
import {
  newChatAtom,
  setNewChat,
  frequentConversationsAtom,
  nowAtom,
  pickConversation,
  pickConversationsAtom,
  pickThread,
  pickThreadsAtom,
  previewTopic,
  registry,
  sendMessage,
  sendTarget,
  type NewChat as NewChatState,
} from '@juno/state'
import { afterPaint, mark } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { Composer, DestinationPickers, NewChat as NewChatView, startOfConversation, type PickerName } from '@juno/views'
import { takeAttachments, useAttachments } from './attachments'
import { useMentions } from './mentions'
import { onNewChatFocus, settleSentChat } from './navigation'
import { useNewChatChecks } from './newChatChecks'
import type { Destination } from './sendChecks'
import { TopicPreview } from './TopicView'

/** The composer's placeholder: "Message" until a destination is picked, then the destination's own. */
function placeholderOf(chat: NewChatState): string {
  const conversation = chat.conversation
  if (conversation === undefined) return 'Message'
  if (chat.thread !== undefined) return 'Reply'
  return conversation.kind === 'public' || conversation.kind === 'private' ? `Message #${conversation.name}` : `Message ${conversation.name}`
}

export interface NewChatTabProps {
  readonly tabId: string
}

/**
 * One New chat tab (spec section 9). The draft and the destination live in
 * `newChatAtom(tabId)`, so they survive a change of destination and the tab
 * being hidden. The pickers' lists are live queries only while open. The
 * frequent list stays after a pick. Without frequent destinations, the
 * preview is the destination's topic, read-only (`TopicPreview`). Enter
 * with no destination opens the conversation picker; Enter after picking
 * sends: the message is queued and the tab becomes its topic at once,
 * with the message pending in it (`settleSentChat`). @ and # suggest
 * people and channels as in a topic (`useMentions`), ranked for the picked
 * conversation once there is one. The tab lives in an `<Activity>`: each time it shows,
 * the composer takes focus.
 */
export const NewChatTab = memo(function NewChatTab({ tabId }: NewChatTabProps) {
  const chat = useAtomValue(newChatAtom(tabId))
  const setChat = (next: NewChatState) => setNewChat(registry, tabId, next)
  const [open, setOpen] = useState<PickerName | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const now = useAtomValue(nowAtom)
  const frequent = useAtomValue(frequentConversationsAtom)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // The files stay with the draft through every change of destination (spec section 9).
  const files = useAttachments(tabId, { tabbable: false })

  useEffect(() => {
    inputRef.current?.focus()
    afterPaint(() => {
      if (inputRef.current === document.activeElement) mark('juno.composer-ready')
    })
  }, [])
  useEffect(() => onNewChatFocus((id) => id === tabId && inputRef.current?.focus()), [tabId])

  const conversationList = useAtomValue(pickConversationsAtom(open === 'conversation' ? query : undefined))
  // A person never messaged has no threads: only Main.
  const channel = chat.conversation?.channelId
  const threadsOpen = open === 'thread' && (chat.conversation === undefined || channel !== undefined)
  const threadList = useAtomValue(pickThreadsAtom(threadsOpen ? { channel, query } : undefined))
  const conversations = useHeld(conversationList._tag === 'Success' ? conversationList.value : undefined, open === 'conversation')
  const threads = useHeld(threadList._tag === 'Success' ? threadList.value : undefined, threadsOpen)

  const openPicker = useCallback((picker: PickerName | undefined) => {
    setQuery('')
    setOpen(picker)
  }, [])

  const picked = (next: (current: NewChatState) => NewChatState) => {
    setChat(next(registry.get(newChatAtom(tabId))))
    setOpen(undefined)
    setQuery('')
    inputRef.current?.focus()
  }

  const send = async (body: string, to: Destination) => {
    const here = sendTarget(chat)
    const target = to.kind === 'thread' && here?.kind === 'channel' ? { ...here, threadTs: to.threadTs } : here
    if (target === undefined) return openPicker('conversation')
    if ((chat.draft.trim() === '' && files.files.length === 0) || sending) return
    const attached = takeAttachments(tabId)
    if (attached === undefined) return
    setSending(true)
    const exit = await sendMessage(registry, target, encodeMentions(body, chat.mentions), undefined, attached.ids)
    if (exit._tag === 'Success') return settleSentChat(tabId, exit.value.topicId)
    // The draft and its files stay; the send can be tried again.
    attached.restore()
    setSending(false)
    console.warn('juno: send failed', exit.cause)
  }

  const checks = useNewChatChecks(chat.draft, sendTarget(chat), (body, to) => { void send(body, to) }, chat.conversation)

  // The atom is read at the moment of each change: a pick sets the mentions and then the text in one event.
  const mentions = useMentions({
    text: chat.draft,
    picks: chat.mentions,
    onPicks: (picks) => setChat({ ...registry.get(newChatAtom(tabId)), mentions: picks }),
    onChange: (draft) => setChat({ ...registry.get(newChatAtom(tabId)), draft }),
    field: inputRef,
    place: { channel: chat.conversation?.channelId, threadTs: chat.thread?.rootTs },
  })

  const topic = previewTopic(chat)
  const person = chat.conversation?.channelId === undefined ? chat.conversation?.person : undefined

  return (
    <NewChatView
      frequent={frequent._tag === 'Success' ? frequent.value : []}
      selectedConversation={chat.conversation?.key}
      onPickConversation={conversation => picked(current => pickConversation(current, conversation))}
      {...(topic === undefined ? {} : { preview: <TopicPreview key={topic} id={topic} /> })}
      {...(person === undefined ? {} : { note: startOfConversation(person.name) })}
      composer={
        <Composer
          value={chat.draft}
          {...mentions}
          onSend={() => { if (!sending && !files.files.some(file => file.state === 'staging')) checks.send() }}
          placeholder={placeholderOf(chat)}
          sending={sending || checks.waiting}
          notices={checks.notices}
          onEscape={checks.clear}
          inputRef={inputRef}
          leading={files.leading}
          attachments={files.chips}
          onFiles={files.onFiles}
          above={
            <DestinationPickers
              conversation={chat.conversation}
              thread={chat.thread}
              open={open}
              onOpen={openPicker}
              query={query}
              onQuery={setQuery}
              conversations={conversations.value}
              threads={threadsOpen ? threads.value : []}
              loading={conversations.loading || threads.loading}
              now={now}
              onPickConversation={(conversation: PickConversation) => picked((current) => pickConversation(current, conversation))}
              onPickThread={(thread: PickThread | undefined) => picked((current) => pickThread(current, thread))}
            />
          }
        />
      }
    />
  )
})

/**
 * A picker list's rows, kept while the next query's rows load, so typing
 * never draws an empty list (inventory 8). `loading` says the rows are an
 * earlier query's. Closing the list drops them, so it opens on fresh rows.
 */
function useHeld<A>(value: A | undefined, open: boolean): { readonly value: A | undefined; readonly loading: boolean } {
  const [held, setHeld] = useState<A | undefined>(undefined)
  if (!open && held !== undefined) setHeld(undefined)
  else if (open && value !== undefined && value !== held) setHeld(value)
  return { value: open ? (value ?? held) : undefined, loading: open && value === undefined }
}
