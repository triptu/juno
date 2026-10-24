/** Local-only ⌘K search. The command reader waits briefly; local results have no debounce. */
import * as Atom from 'effect/reactivity/Atom'
import { newChatRanked, searchCommand, searchQuery } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

/** The palette is open. Kept for the session, so a hidden window brings it back as it was. */
export const paletteOpenAtom = Atom.make(false).pipe(Atom.keepAlive)

/** The palette's four tabs (spec section 10), in the order of ⌘1 to ⌘4. */
export const PALETTE_TABS = ['all', 'conversations', 'messages', 'commands'] as const
export type PaletteTab = (typeof PALETTE_TABS)[number]

/** The tab shown. Each open starts on All; ⌘1 to ⌘4 from the app menu set it while it is open. */
export const paletteTabAtom = Atom.make<PaletteTab>('all').pipe(Atom.keepAlive)

/** Results the Messages tab shows: 8 rows, 6 under a command (inventory 9). */
export const PALETTE_RESULTS = 8
/** Rows with an empty query: the most recent topics. */
export const PALETTE_RECENT = 6
/** More results than rows: a thread's title and message matches share one row. */
const SEARCH_HEADROOM = 4
/** The pause in typing before the command reading is asked for (architecture 7). */
export const COMMAND_DELAY_MS = 150

const searchFamily = liveQuery(searchQuery)

/**
 * Local topics and messages for the palette's text, trimmed so trailing
 * spaces share one subscription. All and Messages read the same rows.
 * Channels and people are left out: the palette lists conversations from
 * `paletteConversationsAtom`.
 */
export const searchAtom = (query: string) => {
  const text = query.trim()
  return searchFamily({ query: text, limit: text === '' ? PALETTE_RECENT : PALETTE_RESULTS + SEARCH_HEADROOM, places: false })
}

const conversationsFamily = liveQuery(newChatRanked)

/** The Conversations tab's rows for the text, trimmed. */
export const paletteConversationsAtom = (query: string) => conversationsFamily({ query: query.trim() })

/** What the text means as a command, or `null`. */
export const readCommand = (registry: Registry, text: string) => runCommand(registry, searchCommand, { text: text.trim() })
