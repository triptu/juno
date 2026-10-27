import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { audienceCheck, decodeDraft, encodeDraft, moveLinks, type MentionPick, type SendTarget, type TopicDetail } from '@juno/contract'
import { aiAssistOnAtom, checkMessage, draftAtom, precheckMessage, registry, saveDraft, sendCheckPrefsAtom, sendMessage, showToast } from '@juno/state'
import { mark } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { AudienceWarning, Composer, ComposerSlot } from '@juno/views'
import { takeAttachments, useAttachments } from './attachments'
import { useComposerLinks } from './composerLinks'
import { useComposerMarkup } from './composerMarkup'
import { useMentions } from './mentions'
import type { ComposerHandle } from './messageActions'
import { preloadBar, sendCheck, SendCheckPanel } from './sendCheckChunk'
import { afterCheck, choose, type CheckBar, type Destination, type Outcome } from './sendChecks'
import { cancelSendMark, markSend } from './sendMark'

/** Typing pauses this long before the draft is written. */
const DRAFT_SAVE_MS = 400

export interface TopicComposerProps {
  readonly detail: TopicDetail
  /** After a send: the list goes to the bottom and the topic is marked read (inventory 7). */
  readonly onSent: () => void
  /** Focus and Quote, for the topic; set once the draft has loaded. */
  readonly handle?: Ref<ComposerHandle>
  /** Called with the field once the draft has loaded; a topic just opened focuses it. */
  readonly takeFocus?: (field: HTMLTextAreaElement) => void
  /** A plain ↑ on the field's first line: the topic selects its newest message. */
  readonly onArrowUpTop?: () => void
  /** Esc with no check bar to close (the open suggestions take it first): the topic selects a message. */
  readonly onEscape?: () => void
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
 * (`drafts.get`), read when the composer mounts and written back after a
 * pause in typing, and at once when the field loses focus, the tab hides or
 * the window closes, so it survives tab switches and restarts; the engine
 * keeps it in step with Slack's draft for the place (`DraftSync`). A draft
 * changed in another tab or on another device fills the field, except while
 * the field has focus and was typed in. Until the draft has loaded, the
 * `ComposerSlot` holds the place.
 * While typing pauses in a Main, the model is asked whether the draft is a
 * reply to a recent topic (`messages.precheck`). Enter runs the checks on
 * send (`messages.check`, spec section 8), which use that answer only if it
 * is already there, unless AI assist is off. When they find nothing the message is queued
 * (`messages.send`, which clears the stored draft in the same transaction)
 * and the pending row shows in the list at once; otherwise the check bar
 * shows inside the composer until a choice, Esc or an edit. The other checks
 * run once the send is accepted and offer a fix line on the sent message. While typing
 * pauses in a public channel, the audience line warns about hiring and
 * people details. Typing @ or # suggests people and user groups, or
 * channels (`useMentions`). A URL pasted over words links them (`useComposerLinks`).
 * Slack's markup shows as it will look, and ⌘B, ⌘I, ⌘⇧X, ⌘⇧C and ⌘⇧9 put it
 * on the selection (`useComposerMarkup`).
 * The draft and the send carry the picked people and channels and the
 * linked words encoded as Slack does (`encodeDraft`), while the checks read
 * the text as shown. A file still staging goes with the send: the message
 * shows as sending at once and the engine posts it when the file is ready,
 * or shows it as not sent when the file could not be read.
 */
export function TopicComposer({ detail, onSent, handle, takeFocus, onArrowUpTop, onEscape, dropping }: TopicComposerProps) {
  const stored = useAtomValue(draftAtom(detail.id))
  const placeholder = detail.kind === 'main' ? `Message ${detail.channel.label}` : 'Reply'
  if (stored._tag !== 'Success') return <ComposerSlot placeholder={placeholder} />
  return <LoadedComposer detail={detail} initial={stored.value.text} latest={stored.value.text} {...(stored.value.replaced === undefined ? {} : { replaced: stored.value.replaced })} placeholder={placeholder} onSent={onSent} handle={handle} takeFocus={takeFocus} onArrowUpTop={onArrowUpTop} onEscape={onEscape} dropping={dropping} />
}

function LoadedComposer({
  detail,
  initial,
  latest,
  replaced,
  placeholder,
  onSent,
  handle,
  takeFocus,
  onArrowUpTop,
  onEscape,
  dropping = false,
}: TopicComposerProps & { readonly initial: string; readonly latest: string; readonly replaced?: string; readonly placeholder: string }) {
  const id = detail.id
  const files = useAttachments(id)
  const aiAssist = useAtomValue(aiAssistOnAtom)
  const wrongPlace = useAtomValue(sendCheckPrefsAtom).some((check) => check.key === 'wrongPlace' && check.enabled)
  const routeChecked = aiAssist && wrongPlace && detail.kind === 'main'
  const [start] = useState(() => decodeDraft(initial))
  const [text, setText] = useState(start.text)
  const [picks, setPicks] = useState(start.picks)
  // Read when the draft is saved or sent, which can be in the same event as a pick.
  const picked = useRef<ReadonlyArray<MentionPick>>(start.picks)
  const field = useRef<HTMLTextAreaElement>(null)
  // Declared before `change`, which it calls back; `change` is a function declaration below.
  const links = useComposerLinks({ field, initialText: start.text, initial: start.links, onChange: (value) => change(value) })
  const encoded = (value: string) => encodeDraft(value, picked.current, links.current())
  // The draft as it was when typing last paused: the audience line reads it.
  const [paused, setPaused] = useState(start.text)
  const [bar, setBar] = useState<CheckBar | undefined>(undefined)
  // The check Enter started; an edit or a newer Enter replaces it, and its answer is dropped.
  const checking = useRef<object | undefined>(undefined)
  const [waiting, setWaiting] = useState(false)
  // A topic just opened: the field takes focus as soon as it is drawn.
  useLayoutEffect(() => {
    if (field.current !== null) takeFocus?.(field.current)
    // Mounted once per topic; `takeFocus` is called only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // A quote just went in: the caret goes after it once it is drawn.
  const [quotedAt, setQuotedAt] = useState(0)
  useLayoutEffect(() => {
    const element = field.current
    if (quotedAt === 0 || element === null) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
    element.scrollTop = element.scrollHeight
  }, [quotedAt])
  // The stored draft as last drawn.
  const latestRef = useRef(latest)
  useLayoutEffect(() => {
    latestRef.current = latest
  })
  // The text not yet written to the store, and the timer that will write it.
  const unsaved = useRef<string | undefined>(undefined)
  // A save went to the store since the last one sent at once: its trip to Slack still waits for a pause.
  const toSlack = useRef(false)
  // What this field wrote to the store since the store last agreed with it: the store coming back with any
  // of them is this field's own echo, maybe trailing quicker saves.
  const written = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // `now`: Slack gets the draft without waiting for a pause in typing (the field lost focus, the tab hid, the window is closing).
  const flush = (now = false) => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (unsaved.current === undefined) {
      // Nothing new to write: only hurry a save that is waiting. A field holding back a newer draft writes nothing.
      if (now && toSlack.current && encoded(text) === latestRef.current) void saveDraft(registry, id, latestRef.current, true)
      if (now) toSlack.current = false
      return
    }
    written.current.add(unsaved.current)
    void saveDraft(registry, id, unsaved.current, now)
    toSlack.current = !now
    unsaved.current = undefined
  }
  const flushRef = useRef(flush)
  useLayoutEffect(() => {
    flushRef.current = flush
  })
  // The tab hid or closed: write what is typed now.
  useEffect(() => () => flushRef.current(true), [])
  // Typed in since this tab last showed: a draft change from the store is then this field's own echo.
  const typedSinceShown = useRef(false)
  useEffect(() => {
    typedSinceShown.current = false
  }, [])
  const take = (draft: string) => {
    written.current.clear()
    const next = decodeDraft(draft)
    picked.current = next.picks
    setPicks(next.picks)
    links.reset(next.text, next.links)
    setText(next.text)
    setPaused(next.text)
  }
  // The draft is the topic's, one for every tab that shows it, and Slack's: another tab or another device
  // changed it. The field takes the new text at once, unless it has typing of its own: typing not yet saved
  // is newer and is saved over it, and a field with focus that was typed in since it showed is left alone so
  // its caret never moves. That field takes the new text when it loses focus with nothing typed since; typing
  // first saves the field's text over it. A field that has focus takes it until it is typed in, so a tab whose
  // press gave it focus still takes the other tab's newer draft.
  const behind = useRef(false)
  useEffect(() => {
    behind.current = false
    // This field's own save coming back: the field may have moved on since (a link edited, more typing).
    if (latest === encoded(text)) return written.current.clear()
    if (written.current.has(latest)) return
    if (unsaved.current !== undefined) return
    if (document.activeElement === field.current && typedSinceShown.current) {
      behind.current = true
      return
    }
    take(latest)
    // Only a change of the stored draft is taken, not this field's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest])
  // Leaving the field saves it to Slack at once, or takes the newer draft it held back.
  useEffect(() => {
    const element = field.current
    if (element === null) return
    const blurred = () => {
      if (behind.current && unsaved.current === undefined) {
        behind.current = false
        take(latestRef.current)
        return
      }
      flushRef.current(true)
    }
    const closing = () => flushRef.current(true)
    element.addEventListener('blur', blurred)
    window.addEventListener('pagehide', closing)
    return () => {
      element.removeEventListener('blur', blurred)
      window.removeEventListener('pagehide', closing)
    }
    // The field and the window live as long as this composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // ⌘Z right after another device's newer draft filled the field brings back the text it replaced, which had
  // not reached Slack (a clock running behind Slack's can make the newer edit look older). It is typing again.
  const recover = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const undo = event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
    if (!undo || replaced === undefined || unsaved.current !== undefined || encoded(text) !== latestRef.current) return false
    event.preventDefault()
    take(replaced)
    typedSinceShown.current = true
    unsaved.current = replaced
    flush()
    return true
  }
  const precheck = (value: string) => {
    if (routeChecked && value.trim() !== '') precheckMessage(registry, detail.channel.id, value)
  }
  // A saved draft is asked about once, as if typing had just paused.
  useEffect(() => {
    preloadBar()
    precheck(start.text)
    // Once per mount: later drafts are asked about as typing pauses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopChecking = () => {
    checking.current = undefined
    setWaiting(false)
  }

  function change(next: string) {
    links.moved(next)
    typedSinceShown.current = true
    // Typed after a newer draft arrived: this text is newer, and is saved over it.
    behind.current = false
    setText(next)
    // Editing closes the bar and drops a check still running: Enter checks the new text.
    setBar(undefined)
    stopChecking()
    unsaved.current = encoded(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPaused(next)
      flush()
      // The route model answers now: Enter never waits for the wrong-place question.
      precheck(next)
    }, DRAFT_SAVE_MS)
  }

  const here = { channelId: detail.channel.id, ...(detail.kind === 'thread' && detail.rootTs !== undefined ? { threadTs: detail.rootTs } : {}) }
  const deliver = (body: string, to: Destination) => {
    const attached = takeAttachments(id, { staging: true })
    if (attached === undefined) return
    // A fixed text ("Fix and send") moves the linked words with its fixes.
    const sentLinks = body === text ? links.current() : moveLinks(text, body, links.current())
    const message = encodeDraft(body, picked.current, sentLinks)
    // The send clears the stored draft; a save still waiting must not write it back.
    clearTimeout(timer.current)
    unsaved.current = undefined
    toSlack.current = false
    links.reset('', [])
    setText('')
    setPaused('')
    setBar(undefined)
    onSent()
    const target: SendTarget = { kind: 'channel', ...(to.kind === 'here' ? here : { channelId: detail.channel.id, threadTs: to.threadTs }) }
    void attached.started.then(() => sendMessage(registry, target, message, id, attached.ids)).then((exit) => {
      if (exit._tag === 'Success') mark('juno.send-queued', undefined, { replace: true })
      if (exit._tag === 'Failure') {
        // Nothing was queued: the text and the files come back so they can be sent again.
        if (field.current?.value === '') {
          links.reset(body, sentLinks)
          setText(body)
        }
        attached.restore()
        console.warn('juno: send failed', exit.cause)
      } else if (to.kind === 'thread') {
        showToast(registry, { text: `Posted in ${to.title}` })
      }
    })
  }
  const follow = (outcome: Outcome) => {
    if (outcome.kind === 'send') deliver(outcome.text, outcome.to)
    else if (outcome.kind === 'bar') setBar(outcome.bar)
    else setBar(undefined)
  }

  const send = () => {
    if (bar !== undefined) return follow(choose(bar, 'primary'))
    if ((text.trim() === '' && files.files.length === 0) || checking.current !== undefined) return
    markSend()
    // Only Wrong place runs before sending, and only in Main. Anything else sends at once.
    if (!routeChecked || text.trim() === '') return deliver(text, { kind: 'here' })
    const token = {}
    checking.current = token
    setWaiting(true)
    void checkMessage(registry, here, text).then(async (found) => {
      const outcome = afterCheck(text, found)
      // Publish the bar with its final geometry, even when Enter beats the idle preload.
      if (outcome.kind === 'bar') await sendCheck.load()
      if (checking.current !== token) return
      mark('juno.send-checked', undefined, { replace: true })
      stopChecking()
      // The send measure is Enter to the pending row; a bar ends it without one.
      if (outcome.kind !== 'send') cancelSendMark()
      follow(outcome)
    })
  }

  // A click on the bar takes the focus; typing goes on in the field.
  const pick = (choice: 'primary' | 'secondary') => {
    field.current?.focus()
    if (bar !== undefined) follow(choose(bar, choice))
  }
  const audience = aiAssist && audienceCheck(text, detail.channel) !== undefined ? audienceCheck(paused, detail.channel) : undefined
  const notices =
    audience === undefined && bar === undefined ? undefined : (
      <>
        {audience === undefined ? null : <AudienceWarning message={audience.message} />}
        {bar === undefined ? null : <SendCheckPanel bar={bar} onPick={pick} />}
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

  const mentions = useMentions({
    text,
    picks,
    onPicks: (next) => {
      picked.current = next
      setPicks(next)
    },
    onChange: change,
    field,
    place: { channel: detail.channel.id, ...(detail.kind === 'thread' && detail.rootTs !== undefined ? { threadTs: detail.rootTs } : {}) },
    groups: true,
  })

  const markup = useComposerMarkup(true)
  // Links are drawn where no picked name is.
  const linkMarks = links.shown(text, picks).map((link) => ({ start: link.start, end: link.end, look: 'link' as const }))
  const marks = [...mentions.marks.filter((mark) => !linkMarks.some((link) => mark.start < link.end && mark.end > link.start)), ...linkMarks].toSorted((a, b) => a.start - b.start)

  return (
    <Composer
      value={text}
      {...mentions}
      onFieldKey={(event) => recover(event) || markup.onKey(event, marks) || mentions.onFieldKey(event)}
      marks={marks}
      {...markup.format(text, marks)}
      onPasteText={links.onPasteText}
      onFieldClick={links.onFieldClick}
      {...(links.popover === undefined ? {} : { popover: links.popover })}
      onSend={send}
      placeholder={placeholder}
      inputRef={field}
      sending={waiting}
      notices={notices}
      {...(bar !== undefined ? { onEscape: () => setBar(undefined) } : onEscape === undefined ? {} : { onEscape })}
      leading={files.leading}
      attachments={files.chips}
      onFiles={files.onFiles}
      dropping={dropping}
      {...(onArrowUpTop === undefined ? {} : { onArrowUpTop })}
    />
  )
}
