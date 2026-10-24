/**
 * What a topic asks for as it opens (spec section 7): the "N new" divider,
 * the fetch of what Slack has that the store lacks, when the window may
 * show, and the read rule.
 */
import { useEffect, useRef, useState } from 'react'
import { readsMarkRead } from '@juno/contract'
import { dividerIndex, messageListAtom, openedAtNewAtom, openTopic as fetchTopic, refreshMessages, registry, runCommand, shouldMarkRead, type MessageWindow } from '@juno/state'
import type { MessageListStatus } from '@juno/views'

/** No "Loading messages" line before this (performance 4.4). */
const LOADING_DELAY_MS = 300

export type FetchState = 'pending' | 'done' | 'offline'

export const markRead = (id: string) => runCommand(registry, readsMarkRead, { id })

export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return focused
}

/**
 * The "N new" divider. It sits where the read pointer was when the tab first showed the topic, so marking
 * read does not move it; Mark as unread moves it to the new pointer. `at` is the first unread row's index;
 * a preview has none.
 */
export function useDivider(id: string, lastReadTs: string | undefined, markedUnread: boolean, list: MessageWindow, readOnly: boolean) {
  // The read pointer when this tab first showed the topic, or when the topic was last marked unread, for the divider.
  const [readAtOpen, setReadAtOpen] = useState(() => ({ lastReadTs }))
  if (markedUnread && lastReadTs !== readAtOpen.lastReadTs) setReadAtOpen({ lastReadTs })
  const at = readOnly ? -1 : dividerIndex(list.order, readAtOpen.lastReadTs, (ts) => list.rows.get(ts)?.fromMe === true)
  const dividerBefore = at > 0 ? list.order[at] : undefined

  // A message sent from the Juno panel carries where the topic opened at a "new" divider (SPEC 7).
  useEffect(() => {
    if (readOnly || registry.get(openedAtNewAtom(id)) === dividerBefore) return
    registry.set(openedAtNewAtom(id), dividerBefore)
  }, [id, readOnly, dividerBefore])
  return { readAtOpen: readAtOpen.lastReadTs, at, dividerBefore }
}

/**
 * What Slack has that the store lacks, once per mount, from when `enabled`; a hidden tab coming back does not
 * ask again. `slow`: still asking after 300 ms. The fetch's rows reach the window in a later update than the
 * fetch's own answer, so a window not yet `shown` settles on `done` only with the window's next answer: on the
 * answer alone it painted what it held before and then the rows the fetch brought (one reply, then 31).
 */
export function useTopicFetch(id: string, view: string, enabled = true, shown = false) {
  'use no memo'
  const [fetchState, setFetchState] = useState<FetchState>('pending')
  const fetched = useRef(false)
  const shownRef = useRef(shown)
  useEffect(() => {
    shownRef.current = shown
  }, [shown])
  const stopWaiting = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => stopWaiting.current?.(), [])
  useEffect(() => {
    if (fetched.current || !enabled) return
    fetched.current = true
    void fetchTopic(registry, id).then((exit) => {
      const done = exit._tag === 'Success' && (exit.value.outcome === 'fetched' || exit.value.outcome === 'cached')
      if (!done) return setFetchState('offline')
      if (shownRef.current) return setFetchState('done')
      // Asked again: the window can also have started while the fetch was writing the history it covers (a first
      // send to someone never messaged) and missed that change. The list keeps its last value while the
      // subscription starts again, so a new `meta` is the new answer.
      const asked = registry.get(messageListAtom(view)).meta
      refreshMessages(registry, view)
      const off = registry.subscribe(messageListAtom(view), () => {
        if (registry.get(messageListAtom(view)).meta === asked) return
        off()
        stopWaiting.current = undefined
        setFetchState('done')
      })
      stopWaiting.current = off
    })
  }, [id, view, enabled])
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (fetchState !== 'pending') return
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [fetchState])
  return { fetchState, slow }
}

/**
 * Whether the window may show (performance.md 3.3). A topic shows what the store holds at once: history it
 * fetched, or for a thread no page proves up to its newest reply what stands in for it (`meta.standIn`). A partial cache (socket or
 * search messages alone) is not an opening window: the header and composer paint, and the messages wait for the
 * fetch, or show what is stored when it cannot finish. A Main window that does not reach back to the read pointer
 * waits for the fetch too, since the divider belongs there. A thread window that stops at replies the store cannot
 * prove (`meta.gapBefore`), or stands in, shows at once even then: it opens at its bottom, and the replies its fetch
 * brings, the divider among them, come in above its rows (`useFromBottom`).
 */
export function windowShown(positioned: boolean, list: MessageWindow, readAtOpen: string | undefined, fetchState: FetchState): boolean {
  const { meta } = list
  const contextLoaded = readAtOpen === undefined || meta.gapBefore === true || meta.standIn === true || (list.order[0] !== undefined && list.order[0] <= readAtOpen)
  const held = meta.windowCovered === true || meta.standIn === true
  return positioned || (held && (contextLoaded || fetchState === 'done')) || fetchState === 'offline' || (fetchState === 'done' && list.order.length >= list.spec.limit)
}

/**
 * The window first showed with replies above it that the store cannot prove (`meta.gapBefore`): its rows sit at
 * the bottom of the list for as long as the view lasts, so the replies its fetch, or a step up, brings in above
 * never move them, even while the list is shorter than the view, and its first row keeps its sender's name and
 * avatar when a reply from the same sender lands above it. Decided once, when the window first shows; the first
 * row then, or undefined.
 */
export function useFromBottom(list: MessageWindow, showWindow: boolean, positioned: boolean): string | undefined {
  const [first, setFirst] = useState<string | undefined>(undefined)
  const at = list.order[0]
  if (first === undefined && showWindow && !positioned && list.meta.gapBefore === true && at !== undefined) setFirst(at)
  return first
}

/** The window stands in for proof (`meta.standIn`) while the open's fetch, which is proving it, is out: page steps wait. */
export const standingIn = (list: MessageWindow, fetchState: FetchState): boolean => list.meta.standIn === true && fetchState === 'pending'

/** An empty list says nothing until Slack has answered or 300 ms have passed. */
export function listStatus(showWindow: boolean, list: MessageWindow, { fetchState, slow }: { readonly fetchState: FetchState; readonly slow: boolean }): MessageListStatus {
  return showWindow && list.order.length > 0 ? 'ready' : fetchState === 'offline' ? 'offline' : list.ready && fetchState === 'done' ? 'ready' : slow ? 'loading' : 'pending'
}

/**
 * The read rule (`shouldMarkRead`). Opening, and showing the tab again, marks the topic read; after
 * that, the bottom of a focused window does, unless the topic was marked unread. A preview never does.
 */
export function useMarkRead(id: string, readOnly: boolean, unread: number, markedUnread: boolean, positioned: boolean, focused: boolean, atBottom: boolean): void {
  'use no memo'
  useEffect(() => {
    if (!readOnly && shouldMarkRead('open', { active: true, focused: true, atBottom: false, markedUnread: false })) void markRead(id)
  }, [id, readOnly])
  useEffect(() => {
    if (readOnly || unread === 0 || !positioned) return
    if (shouldMarkRead('bottom', { active: true, focused, atBottom, markedUnread })) void markRead(id)
  }, [id, readOnly, unread, markedUnread, positioned, focused, atBottom])
}
