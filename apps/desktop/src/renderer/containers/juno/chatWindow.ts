/**
 * The chat's window (see `JunoChat`): the page of the agent's chat it shows,
 * and its rows with the "New" divider.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem, ChatPage, ChatWindow } from '@juno/agent-contract'
import { junoAvailableAtom } from '@juno/state'
import { agentConnectionStateAtom, chatItemsAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'

export type Window = typeof ChatWindow.Type

/** The agent's page limit: the most rows a window holds. */
export const WINDOW = 200
/** The rows the panel opens with: more than its column shows. */
const PANEL_WINDOW = 40
/** Rows kept above the anchor when the window moves. */
export const OVERLAP = 100

export const latest: Window = { _tag: 'latest', limit: WINDOW }
const empty: ChatPage = { items: [], banner: { _tag: 'none' }, moreAbove: false, moreBelow: false, composerEnabled: true }
/** The agent is off: the chat says so and takes no input. */
const off: ChatPage = { ...empty, banner: { _tag: 'aiOff' }, composerEnabled: false }

/**
 * The agent's connection, read as off while AI assist is off and no agent
 * answers: with no provider nothing runs to say so, and the chat would wait
 * on an empty page with its composer on. A running agent sends its own
 * AI-off page, with the history.
 */
export function useAgentState() {
  const state = useAtomValue(agentConnectionStateAtom)
  const aiOn = useAtomValue(junoAvailableAtom)
  return aiOn || state === 'connected' ? state : ('off' as const)
}

/** A row's id the agent can anchor a window on. Separators and the status bubble have none. */
function nextAnchor(items: ReadonlyArray<ChatItem>, index: number): string | undefined {
  const next = items[index + 1]
  return next === undefined ? undefined : anchorOf(next)
}

function bubbleAfterDivider(items: ReadonlyArray<ChatItem>): string | undefined {
  const at = items.findIndex((item) => item._tag === 'newDivider')
  return at < 0 ? undefined : nextAnchor(items, at)
}

export function anchorOf(item: ChatItem): string | undefined {
  switch (item._tag) {
    case 'owner':
      return item.id ?? item.opId
    case 'juno':
    case 'note':
    case 'groupLabel':
      return item.id
    case 'card':
      return item.card.id
    default:
      return undefined
  }
}

/**
 * The window and its page. The tab opens at the "New" divider, the panel at the bottom; the panel opens
 * in one frame (performance 1), so it mounts a screenful and pages up from there. `pageRef` is the
 * latest page, for callbacks.
 */
export function useChatWindow(column: 'page' | 'panel', agent: ReturnType<typeof useAgentState>) {
  const [window, setWindow] = useState<Window>(() => (column === 'page' ? { _tag: 'unread', limit: WINDOW } : { _tag: 'latest', limit: PANEL_WINDOW }))
  const result = useAtomValue(chatItemsAtom(window))
  // The previous window's page shows until the next one arrives: never an empty list in between (performance 5.3).
  const [held, setHeld] = useState<ChatPage | undefined>(undefined)
  const current = result._tag === 'Success' ? result.value : undefined
  if (current !== undefined && current !== held) setHeld(current)
  // A window that reaches the newest row follows it from then on. Only its own page says so, not the one held from before.
  if (current !== undefined && !current.moreBelow && window._tag !== 'latest') setWindow(latest)
  const available = current ?? held ?? empty
  const page = agent === 'off' || available.banner._tag === 'aiOff' ? off : available
  const loaded = current !== undefined || held !== undefined || agent === 'off'
  const pageRef = useRef(page)
  useLayoutEffect(() => {
    pageRef.current = page
  })
  return { page, pageRef, current, loaded, setWindow }
}

/**
 * The page's rows. The "New" divider stays before the bubble it sat over when the chat showed, as a topic's does:
 * an answer that arrives while the chat is open gets none. A hidden tab takes it again when shown.
 */
export function useChatItems(page: ChatPage, current: ChatPage | undefined): ReadonlyArray<ChatItem> {
  const [dividerBefore, setDividerBefore] = useState<string | null | undefined>(undefined)
  if (dividerBefore === undefined && current !== undefined) setDividerBefore(bubbleAfterDivider(current.items) ?? null)
  useEffect(() => () => setDividerBefore(undefined), [])
  return useMemo(() => page.items.filter((item, i) => item._tag !== 'newDivider' || (dividerBefore != null && nextAnchor(page.items, i) === dividerBefore)), [page.items, dividerBefore])
}
