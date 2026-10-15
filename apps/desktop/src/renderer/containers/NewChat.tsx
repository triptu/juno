import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { PickConversation, PickThread } from '@juno/contract'
import {
  newChatAtom,
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
import { useAtom, useAtomValue } from '@juno/state/react'
import { Composer, DestinationPickers, NewChat as NewChatView, startOfConversation, type PickerName } from '@juno/views'
import { takeAttachments, useAttachments } from './attachments'
import { settleSentChat } from './navigation'
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
 * preview is the destination's topic, read-only (`TopicPreview`). Enter
 * with no destination opens the conversation picker; Enter after picking
 * sends: the message is queued and the tab becomes its topic at once,
 * with the message pending in it (`settleSentChat`). The tab lives in an `<Activity>`: each time it shows,
 * the composer takes focus.
 */
export const NewChatTab = memo(function NewChatTab({ tabId }: NewChatTabProps) {
  const [chat, setChat] = useAtom(newChatAtom(tabId))
  const [open, setOpen] = useState<PickerName | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const now = useAtomValue(nowAtom)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // The files stay with the draft through every change of destination (spec section 9).
  const files = useAttachments(tabId)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const conversationList = useAtomValue(pickConversationsAtom(open === 'conversation' ? query : undefined))
  // A person never messaged has no threads: only Main.
  const channel = chat.conversation?.channelId
  const threadsOpen = open === 'thread' && (chat.conversation === undefined || channel !== undefined)
  const threadList = useAtomValue(pickThreadsAtom(threadsOpen ? { channel, query } : undefined))

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

  const send = async () => {
    const target = sendTarget(chat)
    if (target === undefined) return openPicker('conversation')
    if ((chat.draft.trim() === '' && files.files.length === 0) || sending) return
    const attached = takeAttachments(tabId)
    if (attached === undefined) return
    setSending(true)
    const exit = await sendMessage(registry, target, chat.draft, undefined, attached.ids)
    if (exit._tag === 'Success') return settleSentChat(tabId, exit.value.topicId)
    // The draft and its files stay; the send can be tried again.
    attached.restore()
    setSending(false)
    console.warn('juno: send failed', exit.cause)
  }

  const topic = previewTopic(chat)
  const person = chat.conversation?.channelId === undefined ? chat.conversation?.person : undefined

  return (
    <NewChatView
      {...(topic === undefined ? {} : { preview: <TopicPreview key={topic} id={topic} /> })}
      {...(person === undefined ? {} : { note: startOfConversation(person.name) })}
      composer={
        <Composer
          value={chat.draft}
          onChange={(draft) => setChat({ ...registry.get(newChatAtom(tabId)), draft })}
          onSend={() => void send()}
          placeholder={placeholderOf(chat)}
          sending={sending}
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
              conversations={conversationList._tag === 'Success' ? conversationList.value : undefined}
              threads={threadsOpen ? (threadList._tag === 'Success' ? threadList.value : undefined) : []}
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
