import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { audienceCheck, type SendTarget, type TopicDetail } from '@juno/contract'
import { aiAssistOnAtom, checkMessage, draftAtom, registry, saveDraft, sendMessage, showToast } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { AudienceWarning, Composer, ComposerSlot, SendCheckBar } from '@juno/views'
import type { ComposerHandle } from './messageActions'
import { afterCheck, choose, findingOf, type CheckBar, type Destination, type Outcome } from './sendChecks'
import { cancelSendMark, markSend } from './sendMark'

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
 * Enter first runs the checks on send (`messages.check`, spec section 8)
 * unless AI assist is off. When they find nothing the message is queued
 * (`messages.send`, which clears the stored draft in the same transaction)
 * and the pending row shows in the list at once; otherwise the check bar
 * shows inside the composer until a choice, Esc or an edit. While typing
 * pauses in a public channel, the audience line warns about hiring and
 * people details.
 */
export function TopicComposer({ detail, onSent, handle, onArrowUpEmpty }: TopicComposerProps) {
  const stored = useAtomValue(draftAtom(detail.id))
  const placeholder = detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply'
  if (stored._tag !== 'Success') return <ComposerSlot placeholder={placeholder} />
  return <LoadedComposer detail={detail} initial={stored.value} placeholder={placeholder} onSent={onSent} handle={handle} onArrowUpEmpty={onArrowUpEmpty} />
}

function LoadedComposer({ detail, initial, placeholder, onSent, handle, onArrowUpEmpty }: TopicComposerProps & { readonly initial: string; readonly placeholder: string }) {
  const id = detail.id
  const aiAssist = useAtomValue(aiAssistOnAtom)
  const [text, setText] = useState(initial)
  // The draft as it was when typing last paused: the audience line reads it.
  const [paused, setPaused] = useState(initial)
  const [bar, setBar] = useState<CheckBar | undefined>(undefined)
  // The check Enter started; an edit or a newer Enter replaces it, and its answer is dropped.
  const checking = useRef<object | undefined>(undefined)
  const [waiting, setWaiting] = useState(false)
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

  const stopChecking = () => {
    checking.current = undefined
    setWaiting(false)
  }

  const change = (next: string) => {
    setText(next)
    // Editing closes the bar and drops a check still running: Enter checks the new text.
    setBar(undefined)
    stopChecking()
    unsaved.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPaused(next)
      flush()
    }, DRAFT_SAVE_MS)
  }

  const here = { channelId: detail.channel.id, ...(detail.kind === 'thread' && detail.rootTs !== undefined ? { threadTs: detail.rootTs } : {}) }
  const deliver = (body: string, to: Destination) => {
    // The send clears the stored draft; a save still waiting must not write it back.
    clearTimeout(timer.current)
    unsaved.current = undefined
    setText('')
    setPaused('')
    setBar(undefined)
    onSent()
    const target: SendTarget = { kind: 'channel', ...(to.kind === 'here' ? here : { channelId: detail.channel.id, threadTs: to.threadTs }) }
    void sendMessage(registry, target, body, id).then((exit) => {
      if (exit._tag === 'Failure') {
        // Nothing was queued: the text comes back so it can be sent again.
        setText((current) => (current === '' ? body : current))
        console.warn('juno: send failed', exit.cause)
      } else if (to.kind === 'thread') {
        showToast(registry, { text: `Posted in ${to.title}` })
      }
    })
  }
  const follow = (outcome: Outcome) => {
    // A click on the bar took the focus; typing goes on in the field.
    field.current?.focus()
    if (outcome.kind === 'send') deliver(outcome.text, outcome.to)
    else if (outcome.kind === 'bar') setBar(outcome.bar)
    else setBar(undefined)
  }

  const send = () => {
    if (bar !== undefined) return follow(choose(bar, 'primary'))
    if (text.trim() === '' || checking.current !== undefined) return
    markSend()
    if (!aiAssist) return deliver(text, { kind: 'here' })
    const token = {}
    checking.current = token
    setWaiting(true)
    void checkMessage(registry, here, text).then((found) => {
      if (checking.current !== token) return
      stopChecking()
      const outcome = afterCheck(text, found)
      // The send measure is Enter to the pending row; a bar ends it without one.
      if (outcome.kind !== 'send') cancelSendMark()
      follow(outcome)
    })
  }

  const audience = aiAssist && audienceCheck(text, detail.channel) !== undefined ? audienceCheck(paused, detail.channel) : undefined
  const shown = bar === undefined ? undefined : findingOf(bar)
  const notices =
    audience === undefined && shown === undefined ? undefined : (
      <>
        {audience === undefined ? null : <AudienceWarning message={audience.message} />}
        {shown === undefined || bar === undefined ? null : (
          <SendCheckBar finding={shown.finding} confidence={shown.confidence} onPrimary={() => follow(choose(bar, 'primary'))} onSecondary={() => follow(choose(bar, 'secondary'))} />
        )}
      </>
    )

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
      sending={waiting}
      notices={notices}
      {...(bar === undefined ? {} : { onEscape: () => setBar(undefined) })}
      {...(onArrowUpEmpty === undefined ? {} : { onArrowUpEmpty })}
    />
  )
}
