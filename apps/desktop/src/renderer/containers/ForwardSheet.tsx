/**
 * The Forward sheet's draft (spec section 7, "Forward"): where the message
 * goes, the search and the note, local to the open sheet. The list is
 * Home's destination list (`newChat.conversations`, local only); it opens
 * with the sheet. Forward queues the forward and closes the sheet; the
 * toast names the destination and opens it.
 */
import { useState } from 'react'
import type { PickConversation, SendTarget } from '@juno/contract'
import { errorOf, forwardMessage, forwardSheetAtom, nowAtom, pickConversationsAtom, registry, showToast, type ForwardSheetState } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { destinationLabel, ForwardSheet as ForwardSheetView, hueFor, notSentText } from '@juno/views'
import { openTopic } from './navigation'
import { useHeld } from './pickerRows'

/** A conversation's Main, or a person with no DM yet, which the engine opens first. */
const targetOf = (conversation: PickConversation): SendTarget =>
  conversation.channelId === undefined
    ? { kind: 'person', userId: conversation.person?.id ?? conversation.key.slice('u:'.length) }
    : { kind: 'channel', channelId: conversation.channelId }

export function ForwardSheet({ sheet }: { readonly sheet: ForwardSheetState }) {
  const [destination, setDestination] = useState<PickConversation | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const now = useAtomValue(nowAtom)
  const list = useAtomValue(pickConversationsAtom(pickerOpen ? query : undefined))
  const conversations = useHeld(list._tag === 'Success' ? list.value : undefined, pickerOpen)

  const onPickerOpen = (open: boolean) => {
    setQuery('')
    setPickerOpen(open)
  }
  const onPick = (conversation: PickConversation) => {
    setDestination(conversation)
    setPickerOpen(false)
    setQuery('')
  }
  const forward = async () => {
    if (destination === undefined || busy) return
    setBusy(true)
    const exit = await forwardMessage(registry, targetOf(destination), note, { channelId: sheet.channelId, ts: sheet.message.ts })
    setBusy(false)
    if (exit._tag === 'Failure') {
      // Nothing was queued: the sheet stays as it was, and the toast says why in the words of a failed send.
      const error = errorOf(exit)
      showToast(registry, { text: notSentText(error?._tag === 'RpcClientError' ? undefined : error) })
      return
    }
    registry.set(forwardSheetAtom, undefined)
    const topicId = exit.value.topicId
    showToast(registry, { text: `Forwarded to ${destinationLabel(destination)}`, action: { label: 'Open', onAction: () => openTopic(topicId) } })
  }

  return (
    <ForwardSheetView
      message={sheet.message}
      sender={sheet.sender}
      place={sheet.place}
      now={now}
      hueOf={(id) => hueFor(sheet.sender?.id === id ? sheet.sender.color : '', id)}
      destination={destination}
      pickerOpen={pickerOpen}
      onPickerOpen={onPickerOpen}
      query={query}
      onQuery={setQuery}
      conversations={conversations.value}
      loading={conversations.loading}
      onPick={onPick}
      note={note}
      onNote={setNote}
      busy={busy}
      onForward={() => void forward()}
      onCancel={() => registry.set(forwardSheetAtom, undefined)}
    />
  )
}
