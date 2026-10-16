/**
 * What a topic asks for as it opens (spec section 7): the "N new" divider,
 * the fetch of what Slack has that the store lacks, when the window may
 * show, and the read rule.
 */
import { useEffect, useRef, useState } from 'react'
import { readsMarkRead } from '@juno/contract'
import { catchUpDoneAtom, dividerIndex, messageListAtom, openedAtNewAtom, openTopic as fetchTopic, refreshMessages, registry, runCommand, shouldMarkRead, type MessageWindow } from '@juno/state'
import type { MessageListStatus } from '@juno/views'

/** No "Loading messages" line before this (performance 4.4). */
const LOADING_DELAY_MS = 300

type FetchState = 'pending' | 'done' | 'offline'

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
 * read does not move it. `at` is the first unread row's index; a preview has none.
 */
export function useDivider(id: string, lastReadTs: string | undefined, list: MessageWindow, readOnly: boolean) {
  // The read pointer when this tab first showed the topic, for the divider.
  const [readAtOpen] = useState(() => ({ lastReadTs }))
  const at = readOnly ? -1 : dividerIndex(list.order, readAtOpen.lastReadTs, (ts) => list.rows.get(ts)?.fromMe === true)
  const dividerBefore = at > 0 ? list.order[at] : undefined

  // The Juno panel offers Catch me up while the topic opened at a "new" divider (SPEC 7); a new divider offers it again.
  useEffect(() => {
    if (readOnly || registry.get(openedAtNewAtom(id)) === dividerBefore) return
    registry.set(openedAtNewAtom(id), dividerBefore)
    registry.set(catchUpDoneAtom(id), false)
  }, [id, readOnly, dividerBefore])
  return { readAtOpen: readAtOpen.lastReadTs, at, dividerBefore }
}

/** What Slack has that the store lacks, once per mount; a hidden tab coming back does not ask again. `slow`: still asking after 300 ms. */
export function useTopicFetch(id: string, view: string) {
  'use no memo'
  const [fetchState, setFetchState] = useState<FetchState>('pending')
  const fetched = useRef(false)
  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    void fetchTopic(registry, id).then((exit) => {
      const done = exit._tag === 'Success' && (exit.value.outcome === 'fetched' || exit.value.outcome === 'cached')
      // This tab's window can have started while the fetch was writing the history it covers (a first send
      // to someone never messaged) and missed that change; ask for it again, or it never shows its rows.
      if (done && registry.get(messageListAtom(view)).meta.windowCovered !== true) refreshMessages(registry, view)
      setFetchState(done ? 'done' : 'offline')
    })
  }, [id, view])
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (fetchState !== 'pending') return
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [fetchState])
  return { fetchState, slow }
}

/**
 * A partial cache is not an opening window. The header and composer paint immediately;
 * messages wait for coverage, or show the available cache when fetching cannot finish.
 */
export function windowShown(positioned: boolean, list: MessageWindow, readAtOpen: string | undefined, fetchState: FetchState): boolean {
  const contextLoaded = readAtOpen === undefined || (list.order[0] !== undefined && list.order[0] <= readAtOpen)
  return positioned || (list.meta.windowCovered === true && (contextLoaded || fetchState === 'done')) || fetchState === 'offline' || (fetchState === 'done' && list.order.length >= list.spec.limit)
}

/** An empty list says nothing until Slack has answered or 300 ms have passed. */
export function listStatus(showWindow: boolean, list: MessageWindow, { fetchState, slow }: { readonly fetchState: FetchState; readonly slow: boolean }): MessageListStatus {
  return showWindow && list.order.length > 0 ? 'ready' : fetchState === 'offline' ? 'offline' : list.ready && fetchState === 'done' ? 'ready' : slow ? 'loading' : 'pending'
}

/**
 * The read rule (`shouldMarkRead`). Opening, and showing the tab again, marks the topic read; after
 * that, the bottom of a focused window does. A preview never does.
 */
export function useMarkRead(id: string, readOnly: boolean, unread: number, positioned: boolean, focused: boolean, atBottom: boolean): void {
  'use no memo'
  useEffect(() => {
    if (!readOnly && shouldMarkRead('open', { active: true, focused: true, atBottom: false })) void markRead(id)
  }, [id, readOnly])
  useEffect(() => {
    if (readOnly || unread === 0 || !positioned) return
    if (shouldMarkRead('bottom', { active: true, focused, atBottom })) void markRead(id)
  }, [id, readOnly, unread, positioned, focused, atBottom])
}
