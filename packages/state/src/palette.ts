/**
 * State for ⌘K (spec section 10, performance 4.3): whether the palette is
 * open, the local search live value, and the two one-shot calls that come
 * after it, Slack's search and the command reading.
 *
 * Local search has no debounce: the container feeds `searchAtom` through
 * `useDeferredValue`, so typing is never blocked. The command and Slack's
 * search wait for a pause in typing (`COMMAND_DELAY_MS`, `SLACK_DELAY_MS`)
 * and never delay the local rows.
 */
import * as Atom from 'effect/reactivity/Atom'
import { searchCommand, searchQuery, searchSlack } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

/** The palette is open. Kept for the session, so a hidden window brings it back as it was. */
export const paletteOpenAtom = Atom.make(false).pipe(Atom.keepAlive)

/** Results the palette asks the engine for: it shows 8 rows, 6 under a command (inventory 9). */
export const PALETTE_RESULTS = 8
/** Rows with an empty query: the most recent topics. */
export const PALETTE_RECENT = 6
/** Slack's matches the palette adds under the local rows, at most. */
export const PALETTE_SLACK_RESULTS = 4
/** The pause in typing before the command reading is asked for (architecture 7). */
export const COMMAND_DELAY_MS = 150
/** The pause in typing before Slack's search is asked; it calls Slack, so it waits longer. */
export const SLACK_DELAY_MS = 400
/** Slack's search runs only for text at least this long. */
export const SLACK_MIN_LENGTH = 3

const searchFamily = liveQuery(searchQuery)

/** Local results for the palette's text, trimmed so trailing spaces share one subscription. */
export const searchAtom = (query: string) => {
  const text = query.trim()
  return searchFamily({ query: text, limit: text === '' ? PALETTE_RECENT : PALETTE_RESULTS })
}

/** Slack's message search for `query`. Empty when Slack cannot be reached. */
export const searchSlackMessages = (registry: Registry, query: string) => runCommand(registry, searchSlack, { query: query.trim() })

/** What the text means as a command, or `null`. */
export const readCommand = (registry: Registry, text: string) => runCommand(registry, searchCommand, { text: text.trim() })

/**
 * The rows shown, then `more` that are not among them, up to `max` added.
 * Rows already on screen never move when later results arrive.
 */
export function appendUnseen<T extends { readonly id: string }>(shown: ReadonlyArray<T>, more: ReadonlyArray<T>, max: number): ReadonlyArray<T> {
  const seen = new Set(shown.map((row) => row.id))
  const added = more.filter((row) => !seen.has(row.id)).slice(0, max)
  return added.length === 0 ? shown : [...shown, ...added]
}
