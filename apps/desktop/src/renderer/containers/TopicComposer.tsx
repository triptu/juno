import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import type { SendTarget, TopicDetail } from '@juno/contract'
import { draftAtom, registry, saveDraft, sendMessage } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Composer, ComposerSlot } from '@juno/views'
import { takeAttachments, useAttachments } from './attachments'
import type { ComposerHandle } from './messageActions'
import { markSend } from './sendMark'

/** Typing pauses this long before the draft is written. */
const DRAFT_SAVE_MS = 400

export interface TopicComposerProps {
  readonly detail: TopicDetail
  /** After a send: the list goes to the bottom and the topic is marked read (inventory 7). */
  readonly onSent: () => void
  /** Focus and Quote, for the topic; set once the draft has loaded. */
  readonly handle?: Ref<ComposerHandle>
  /** ↑ in the empty field: the topic selects its newest message. */
  readonly onArrowUpEmpty?: () => void
  /** Files are being dragged over the topic. */
  readonly dropping?: boolean
}

/** `text` as Slack quotes it: every line starts with "> ". */
export function quoted(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

/** The draft with a quote added at its end, on its own lines, and a fresh line after it for the reply (inventory 7.4). */
export function withQuote(draft: string, text: string): string {
  const before = draft.replace(/\s+$/, '')
  return `${before === '' ? '' : `${before}\n`}${quoted(text)}\n`
}

/**
 * The composer of a topic tab (spec section 8). The draft is the topic's
 * (`drafts.get`), read once when the composer mounts and written back after
 * a pause in typing and when the tab hides, so it survives tab switches and
 * restarts. Until the draft has loaded, the `ComposerSlot` holds the place.
 * Enter queues the message (`messages.send`, which clears the stored draft
 * in the same transaction); the pending row shows in the list at once.
 */
export function TopicComposer({ detail, onSent, handle, onArrowUpEmpty, dropping }: TopicComposerProps) {
  const stored = useAtomValue(draftAtom(detail.id))
  const placeholder = detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply'
  if (stored._tag !== 'Success') return <ComposerSlot placeholder={placeholder} />
  return <LoadedComposer detail={detail} initial={stored.value} placeholder={placeholder} onSent={onSent} handle={handle} onArrowUpEmpty={onArrowUpEmpty} dropping={dropping} />
}

function LoadedComposer({ detail, initial, placeholder, onSent, handle, onArrowUpEmpty, dropping = false }: TopicComposerProps & { readonly initial: string; readonly placeholder: string }) {
  const id = detail.id
  const files = useAttachments(id)
  const [text, setText] = useState(initial)
  const field = useRef<HTMLTextAreaElement>(null)
  // A quote just went in: the caret goes after it once it is drawn.
  const [quotedAt, setQuotedAt] = useState(0)
  useLayoutEffect(() => {
    const element = field.current
    if (quotedAt === 0 || element === null) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
    element.scrollTop = element.scrollHeight
  }, [quotedAt])
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
    if (text.trim() === '' && files.files.length === 0) return
    const attached = takeAttachments(id)
    // A file is still on its way to the engine: Enter waits for it.
    if (attached === undefined) return
    markSend()
    // The send clears the stored draft; a save still waiting must not write it back.
    clearTimeout(timer.current)
    unsaved.current = undefined
    setText('')
    onSent()
    void sendMessage(registry, target, text, id, attached.ids).then((exit) => {
      if (exit._tag === 'Failure') {
        // Nothing was queued: the text and the files come back so they can be sent again.
        setText((current) => (current === '' ? text : current))
        attached.restore()
        console.warn('juno: send failed', exit.cause)
      }
    })
  }

  useImperativeHandle(handle, () => ({
    focus: () => field.current?.focus(),
    quote: (quote: string) => {
      if (quote.trim() === '') return
      change(withQuote(text, quote))
      setQuotedAt((count) => count + 1)
    },
  }))

  return (
    <Composer
      value={text}
      onChange={change}
      onSend={send}
      placeholder={placeholder}
      inputRef={field}
      leading={files.leading}
      attachments={files.chips}
      onFiles={files.onFiles}
      dropping={dropping}
      {...(onArrowUpEmpty === undefined ? {} : { onArrowUpEmpty })}
    />
  )
}
