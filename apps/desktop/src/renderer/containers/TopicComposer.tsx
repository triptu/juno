import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SendTarget, TopicDetail } from '@juno/contract'
import { draftAtom, registry, saveDraft, sendMessage } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Composer, ComposerSlot } from '@juno/views'
import { markSend } from './sendMark'

/** Typing pauses this long before the draft is written. */
const DRAFT_SAVE_MS = 400

export interface TopicComposerProps {
  readonly detail: TopicDetail
  /** After a send: the list goes to the bottom and the topic is marked read (inventory 7). */
  readonly onSent: () => void
}

/**
 * The composer of a topic tab (spec section 8). The draft is the topic's
 * (`drafts.get`), read once when the composer mounts and written back after
 * a pause in typing and when the tab hides, so it survives tab switches and
 * restarts. Until the draft has loaded, the `ComposerSlot` holds the place.
 * Enter queues the message (`messages.send`, which clears the stored draft
 * in the same transaction); the pending row shows in the list at once.
 */
export function TopicComposer({ detail, onSent }: TopicComposerProps) {
  const stored = useAtomValue(draftAtom(detail.id))
  const placeholder = detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply'
  if (stored._tag !== 'Success') return <ComposerSlot placeholder={placeholder} />
  return <LoadedComposer detail={detail} initial={stored.value} placeholder={placeholder} onSent={onSent} />
}

function LoadedComposer({ detail, initial, placeholder, onSent }: TopicComposerProps & { readonly initial: string; readonly placeholder: string }) {
  const id = detail.id
  const [text, setText] = useState(initial)
  // The text not yet written to the store, and the timer that will write it.
  const unsaved = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (unsaved.current === undefined) return
    void saveDraft(registry, id, unsaved.current)
    unsaved.current = undefined
  }
  const flushRef = useRef(flush)
  useLayoutEffect(() => {
    flushRef.current = flush
  })
  // The tab hid or closed: write what is typed now.
  useEffect(() => () => flushRef.current(), [])

  const change = (next: string) => {
    setText(next)
    unsaved.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, DRAFT_SAVE_MS)
  }

  const target: SendTarget = { kind: 'channel', channelId: detail.channel.id, ...(detail.kind === 'thread' && detail.rootTs !== undefined ? { threadTs: detail.rootTs } : {}) }
  const send = () => {
    if (text.trim() === '') return
    markSend()
    // The send clears the stored draft; a save still waiting must not write it back.
    clearTimeout(timer.current)
    unsaved.current = undefined
    setText('')
    onSent()
    void sendMessage(registry, target, text, id).then((exit) => {
      if (exit._tag === 'Failure') {
        // Nothing was queued: the text comes back so it can be sent again.
        setText((current) => (current === '' ? text : current))
        console.warn('juno: send failed', exit.cause)
      }
    })
  }

  return <Composer value={text} onChange={change} onSend={send} placeholder={placeholder} />
}
