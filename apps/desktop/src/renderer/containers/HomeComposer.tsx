import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { encodeMentions, type PickConversation, type PickConversations } from '@juno/contract'
import {
  emptyHomeDraft,
  frequentConversationsAtom,
  homeDraftAtom,
  homeFocusAtom,
  homeViewAtom,
  junoAvailableAtom,
  pickConversation,
  pickConversationsAtom,
  registry,
  sendMessage,
  sendTarget,
  setHomeDraft,
  showToast,
  tabsAtom,
  type HomeDraft,
} from '@juno/state'
import { junoNavAtom } from '@juno/state/agent'
import { afterPaint, mark } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { Composer, DestinationChip, destinationLabel, HomeRecent, HomeWriteTop, releaseKeys, SendToList, sendToRowId, type ComposerMention } from '@juno/views'
import { takeAttachments, useAttachments } from './attachments'
import { useHomeSendChecks } from './homeSendChecks'
import { junoCommands } from './juno/actions'
import { useMentions } from './mentions'
import { openJuno, openTopic } from './navigation'
import { useHeld } from './pickerRows'
import type { Destination } from './sendChecks'

/** A first @ or # with what follows it, and nothing else typed yet. */
const FIRST = /^([@#])([^\s@#]*)$/

const isPeople = (conversation: PickConversation) => conversation.kind === 'im' || conversation.kind === 'mpim'

/** The "Send to" rows for a first @ (people) or # (channels): the recent ones that match, then the rest, at most six. */
function sendToRows(sections: PickConversations | undefined, trigger: '@' | '#'): ReadonlyArray<PickConversation> {
  if (sections === undefined) return []
  const wanted = (conversation: PickConversation) => (trigger === '@' ? isPeople(conversation) : !isPeople(conversation))
  const seen = new Set<string>()
  return [...sections.recent, ...sections.people, ...sections.channels].filter((row) => wanted(row) && !seen.has(row.key) && seen.add(row.key)).slice(0, 6)
}

function placeholderOf(draft: HomeDraft, junoOn: boolean, jobLine: string | undefined): string {
  if (draft.conversation !== undefined) return `Message ${destinationLabel(draft.conversation)}`
  if (!junoOn) return 'Start with @ for a person or # for a channel'
  // A running job's state line replaces the placeholder while Juno is chosen (SPEC 13.4).
  return jobLine ?? 'Ask Juno, or start with @ or #'
}

/**
 * A first @ or # while Juno is chosen: the "Send to" rows, the highlighted
 * one, and the keys that drive them. Esc closes them until the text stops
 * starting that way.
 */
function useSendTo(draft: HomeDraft, onPick: (conversation: PickConversation | undefined) => void) {
  const [dismissed, setDismissed] = useState(false)
  const first = draft.conversation === undefined && !dismissed ? FIRST.exec(draft.draft) : null
  const trigger = first?.[1] as '@' | '#' | undefined
  const result = useAtomValue(pickConversationsAtom(first === null ? undefined : first[2]))
  const held = useHeld(result._tag === 'Success' ? result.value : undefined, first !== null)
  const rows = trigger === undefined ? [] : sendToRows(held.value, trigger)
  const [chosenKey, setChosenKey] = useState<string | undefined>(undefined)
  const activeKey = rows.some((row) => row.key === chosenKey) ? chosenKey : rows[0]?.key
  const open = trigger !== undefined && rows.length > 0 && activeKey !== undefined
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.metaKey || event.altKey || event.ctrlKey) return false
    const at = rows.findIndex((row) => row.key === activeKey)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setChosenKey(rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]!.key)
      return true
    }
    if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) {
      event.preventDefault()
      onPick(rows[at])
      return true
    }
    if (event.key !== 'Escape') return false
    event.preventDefault()
    setDismissed(true)
    return true
  }
  return {
    trigger,
    rows,
    activeKey,
    open,
    onKey,
    choose: setChosenKey,
    pick: (key: string) => onPick(rows.find((row) => row.key === key)),
    dismiss: () => setDismissed(true),
    /** A change that no longer starts with @ or # lets the next one open the list again. */
    typed: (value: string) => {
      if (dismissed && !FIRST.test(value)) setDismissed(false)
    },
  }
}

/** The "Send to" rows as the composer's suggestions, while they are open. */
function sendToMention(sendTo: ReturnType<typeof useSendTo>, listId: string): ComposerMention | undefined {
  if (!sendTo.open || sendTo.trigger === undefined || sendTo.activeKey === undefined) return undefined
  return {
    anchorAt: 0,
    listId,
    activeId: sendToRowId(listId, sendTo.activeKey),
    list: <SendToList kind={sendTo.trigger === '@' ? 'person' : 'channel'} rows={sendTo.rows} id={listId} activeKey={sendTo.activeKey} onActivate={sendTo.choose} onPick={sendTo.pick} />,
    onDismiss: sendTo.dismiss,
  }
}

/**
 * ⌘N, ⌘T and "+" ask this Home to focus its field, and with ⌘N to open its
 * destination list. Keys typed since the shortcut were held
 * (`holdKeys`); they are typed into the field or the search once it has
 * focus, which for a search not yet mounted is when it mounts.
 */
function useFocusRequest(tabId: string, field: () => HTMLElement | null | undefined, openList: () => void, search: () => HTMLElement | null | undefined): void {
  const request = useAtomValue(homeFocusAtom)
  const active = useAtomValue(tabsAtom, (tabs) => tabs.active === tabId)
  // Taken during render, so the list is open in the same frame; the focus moves once it has painted.
  const [taken, setTaken] = useState<number | undefined>(undefined)
  const due = request?.tabId === tabId && active && request.seq !== taken ? request : undefined
  if (due !== undefined) {
    setTaken(due.seq)
    if (due.list) openList()
  }
  useEffect(() => {
    const request = registry.get(homeFocusAtom)
    if (taken === undefined || request?.seq !== taken) return
    registry.set(homeFocusAtom, undefined)
    // With the list, focus goes to its search: its own autoFocus can run while a new tab is still hidden, and
    // moving focus to the field would close the list.
    const target = request.list ? search : field
    target()?.focus()
    if (target() === document.activeElement) return releaseKeys()
    const root = field()?.closest('[data-home]')
    const onFocus = () => {
      if (target() !== document.activeElement) return
      root?.removeEventListener('focusin', onFocus)
      releaseKeys()
    }
    root?.addEventListener('focusin', onFocus)
    return () => root?.removeEventListener('focusin', onFocus)
  }, [taken, field, search])
}

/** Sends the draft where it goes: Juno opens its chat with the question; a person or channel gets it in its Main and Home stays. */
async function deliver(tabId: string, body: string, to: Destination, junoOn: boolean, openList: () => void): Promise<boolean> {
  const current = registry.get(homeDraftAtom(tabId))
  const here = sendTarget(current)
  if (here === undefined) {
    if (!junoOn) {
      openList()
      return false
    }
    if (body.trim() === '') return false
    junoCommands.send(body)
    setHomeDraft(registry, tabId, emptyHomeDraft)
    openJuno()
    return true
  }
  const target = to.kind === 'thread' && here.kind === 'channel' ? { ...here, threadTs: to.threadTs } : here
  const attached = takeAttachments(tabId)
  if (attached === undefined) return false
  // A send to a channel's or a group DM's Main starts a thread there (SPEC 9).
  const startsThread = target.kind === 'channel' && target.threadTs === undefined && current.conversation?.kind !== 'im'
  const exit = await sendMessage(registry, target, encodeMentions(body, current.mentions), undefined, attached.ids, startsThread)
  if (exit._tag === 'Success') {
    setHomeDraft(registry, tabId, emptyHomeDraft)
    if (current.conversation !== undefined) showToast(registry, { text: `Sent to ${destinationLabel(current.conversation)}` })
    return true
  }
  // The draft and its files stay; the send can be tried again.
  attached.restore()
  console.warn('juno: send failed', exit.cause)
  return false
}

/** Where the draft goes, and the chip's list: choosing from Recent, the list or a first @ or # sets it and puts focus back in the field. */
function useDestination(tabId: string, focusField: () => void) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const openList = () => {
    setQuery('')
    setOpen(true)
  }
  const choose = (conversation: PickConversation | undefined, clearText = false) => {
    const current = registry.get(homeDraftAtom(tabId))
    setHomeDraft(registry, tabId, clearText ? { ...pickConversation(current, conversation), draft: '', mentions: [] } : pickConversation(current, conversation))
    setOpen(false)
    setQuery('')
    focusField()
  }
  const onOpen = (next: boolean) => {
    if (next) return openList()
    setOpen(false)
    focusField()
  }
  return { openList, choose, chip: { open, query, onQuery: setQuery, onOpen, onPick: (conversation: PickConversation | undefined) => choose(conversation) } }
}

/** Sending, with the button held while a send is on its way. An empty draft to a person or channel sends nothing. */
function useSend(tabId: string, hasFiles: boolean, junoOn: boolean, openList: () => void) {
  const [sending, setSending] = useState(false)
  const send = async (body: string, to: Destination) => {
    const current = registry.get(homeDraftAtom(tabId))
    if (sending || (sendTarget(current) !== undefined && current.draft.trim() === '' && !hasFiles)) return
    setSending(true)
    await deliver(tabId, body, to, junoOn, openList)
    setSending(false)
  }
  return { sending, send }
}

export interface HomeComposerProps {
  readonly tabId: string
}

/**
 * Home's composer (SPEC section 12, "Writing"): Recent, the destination
 * chip and the field, at the bottom of Home. The draft and the destination
 * live in `homeDraftAtom(tabId)`, so they survive a tab switch and a
 * restart. Juno is the destination until another is chosen, from Recent,
 * the chip's list, or a first @ or #: those suggest without taking over
 * (Tab or Enter picks, Space or Esc keeps the text for Juno). Backspace in
 * an empty field goes back to Juno. A send to a person or channel goes to
 * its Main (a channel's starts a thread), and Home stays: the field
 * empties, the destination goes back to Juno and a toast says where it
 * went. A send to Juno opens the Juno chat with the question.
 */
export const HomeComposer = memo(function HomeComposer({ tabId }: HomeComposerProps) {
  const draft = useAtomValue(homeDraftAtom(tabId))
  const latest = () => registry.get(homeDraftAtom(tabId))
  const set = (next: HomeDraft) => setHomeDraft(registry, tabId, next)
  const junoOn = useAtomValue(junoAvailableAtom)
  const jobLine = useAtomValue(junoNavAtom, (nav) => nav.jobLine)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const files = useAttachments(tabId, { tabbable: false })
  const listId = useId()
  const focusField = useCallback(() => inputRef.current?.focus(), [])
  const field = useCallback(() => inputRef.current, [])
  const search = useCallback(() => inputRef.current?.closest('[data-home]')?.querySelector<HTMLElement>('[role="dialog"][aria-label="Send to"] input'), [])
  const destination = useDestination(tabId, focusField)
  const sendTo = useSendTo(draft, (conversation) => destination.choose(conversation, true))
  useFocusRequest(tabId, field, destination.openList, search)

  // Shown again: the field takes focus, so keys typed after ⌘T or a click on Home reach it.
  useLayoutEffect(() => {
    focusField()
    afterPaint(() => {
      if (inputRef.current === document.activeElement) mark('juno.composer-ready')
    })
  }, [focusField])

  const { sending, send } = useSend(tabId, files.files.length > 0, junoOn, destination.openList)
  const sendToList = sendToMention(sendTo, listId)
  const checks = useHomeSendChecks(draft.draft, sendTarget(draft), (body, to) => void send(body, to), draft.conversation)

  const mentions = useMentions({
    text: draft.draft,
    picks: draft.mentions,
    onPicks: (picks) => set({ ...latest(), mentions: picks }),
    onChange: (text) => set({ ...latest(), draft: text }),
    field: inputRef,
    place: { channel: draft.conversation?.channelId, threadTs: undefined },
  })
  // Juno takes plain text: the @ and # suggestions are for people and channels in Slack.
  const toSlack = draft.conversation !== undefined

  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing) return false
    if (sendTo.onKey(event)) return true
    if (event.key === 'Backspace' && toSlack && event.currentTarget.value === '' && !event.metaKey) {
      event.preventDefault()
      destination.choose(undefined)
      return true
    }
    return toSlack ? mentions.onFieldKey(event) : false
  }

  return (
    <Composer
      value={draft.draft}
      // Marks always, empty for Juno: the field keeps one structure, so a change of destination never remounts it and loses focus.
      marks={toSlack ? mentions.marks : []}
      {...(toSlack ? { onCaret: mentions.onCaret, ...(mentions.mention === undefined ? {} : { mention: mentions.mention }) } : {})}
      {...(sendToList === undefined ? {} : { mention: sendToList })}
      onChange={(value, caret) => {
        sendTo.typed(value)
        if (toSlack) mentions.onChange(value, caret)
        else set({ ...latest(), draft: value })
      }}
      onFieldKey={onFieldKey}
      onSend={() => {
        if (!sending && !files.files.some((file) => file.state === 'staging')) checks.send()
      }}
      placeholder={placeholderOf(draft, junoOn, jobLine)}
      sending={sending || checks.waiting}
      notices={checks.notices}
      onEscape={checks.clear}
      inputRef={inputRef}
      {...(toSlack ? { leading: files.leading } : {})}
      attachments={files.chips}
      onFiles={files.onFiles}
      above={<HomeWriteTop recent={<Recent chosen={draft.conversation?.key} onPick={destination.choose} />} chip={<Chip destination={draft.conversation} junoOn={junoOn} {...destination.chip} />} />}
    />
  )
})

/** Recent, from the local ranking: five people and five channels. ⌘-click or ⌘Enter opens a conversation instead of choosing it. */
function Recent({ chosen, onPick }: { readonly chosen: string | undefined; readonly onPick: (conversation: PickConversation) => void }) {
  const frequent = useAtomValue(frequentConversationsAtom)
  const recent = frequent._tag === 'Success' ? frequent.value : []
  // While the first sync runs or the ranking is on its way, Recent keeps its room, so the chip and the field never move.
  const syncing = useAtomValue(homeViewAtom, (result) => result._tag !== 'Success' || !result.value.ready)
  return (
    <HomeRecent
      people={recent.filter(isPeople)}
      channels={recent.filter((conversation) => !isPeople(conversation))}
      chosen={chosen}
      onPick={onPick}
      onOpen={(conversation) => (conversation.mainId === undefined ? onPick(conversation) : openTopic(conversation.mainId, { newTab: true }))}
      reserve={syncing || frequent._tag !== 'Success'}
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
}

/** The destination chip, with its list's live query while it is open. */
function Chip({ destination, junoOn, open, query, onQuery, onOpen, onPick }: ChipProps) {
  const list = useAtomValue(pickConversationsAtom(open ? query : undefined))
  const conversations = useHeld(list._tag === 'Success' ? list.value : undefined, open)
  return <DestinationChip destination={destination} juno={junoOn} open={open} onOpen={onOpen} query={query} onQuery={onQuery} conversations={conversations.value} loading={conversations.loading} onPick={onPick} />
}
