/**
 * Home's thought (SPEC 12, "A thought"): one short quote or fact under the
 * greeting while Home has no rows.
 *
 * - The list (`homeThoughtList.ts`) is its own chunk, loaded when idle after
 *   Home's first paint (`prepareThought`), so it never grows the start bundle.
 * - This Mac keeps in local storage whether thoughts show (Settings ›
 *   General), the thoughts it has shown, the one showing and the next one,
 *   so Home has its thought in its first frame without the list.
 * - A Home that appears within `SAME_THOUGHT_MILLIS` of taking its thought
 *   shows the same one; after that gap it takes the next. A thought is not
 *   shown twice until every thought in the list has been.
 */
import * as Atom from 'effect/reactivity/Atom'
import type { Registry } from './client'

export type ThoughtTheme = 'focus' | 'thinking' | 'wonder' | 'life' | 'made' | 'art'

/** What Home shows: the line, and who said it when it is a quote. */
export interface HomeThought {
  readonly text: string
  readonly by?: string
}

/** One entry of the list. `source` is never shown; it is there to check the entry against. */
export interface ThoughtEntry extends HomeThought {
  readonly theme: ThoughtTheme
  readonly source: string
}

/** A Home that comes back within this long of taking its thought shows the same one. */
export const SAME_THOUGHT_MILLIS = 10 * 60_000

const STORAGE_KEY = 'juno.homeThoughts'

interface Saved {
  /** Settings › General, "Show a thought when Home is empty", turned off. */
  readonly off?: boolean
  /** Ids (`thoughtId`) of the thoughts shown since the list last started over, the next one included. */
  readonly seen: ReadonlyArray<string>
  readonly current?: { readonly thought: HomeThought; readonly at: number }
  readonly next?: HomeThought
}

/** The part of `Storage` used here; the state package has no DOM types. */
interface ThoughtStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Local storage, or memory where there is none (unit tests). */
const memory = new Map<string, string>()
const storage = (): ThoughtStorage =>
  (globalThis as { readonly localStorage?: ThoughtStorage }).localStorage ?? { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value) }

function isThought(value: unknown): value is HomeThought {
  if (typeof value !== 'object' || value === null) return false
  const { text, by } = value as { text?: unknown; by?: unknown }
  return typeof text === 'string' && text !== '' && (by === undefined || typeof by === 'string')
}

function read(): Saved {
  try {
    const value: unknown = JSON.parse(storage().getItem(STORAGE_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null) return { seen: [] }
    const raw = value as { off?: unknown; seen?: unknown; current?: { thought?: unknown; at?: unknown }; next?: unknown }
    return {
      ...(raw.off === true ? { off: true } : {}),
      seen: Array.isArray(raw.seen) ? raw.seen.filter((id): id is string => typeof id === 'string') : [],
      ...(isThought(raw.current?.thought) && typeof raw.current.at === 'number' ? { current: { thought: raw.current.thought, at: raw.current.at } } : {}),
      ...(isThought(raw.next) ? { next: raw.next } : {}),
    }
  } catch {
    return { seen: [] }
  }
}

function write(saved: Saved): void {
  try {
    storage().setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Storage full or unavailable: the thought still shows, it may repeat sooner.
  }
}

/** A short stable id from the text, so editing the list never mixes up what was seen. */
export function thoughtId(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  return hash.toString(36)
}

const shown = (entry: ThoughtEntry): HomeThought => (entry.by === undefined ? { text: entry.text } : { text: entry.text, by: entry.by })

/**
 * The next thought: one not seen yet, at `random` (0 to 1) among them. Once
 * every thought has been seen the list starts over, without the ones in
 * `avoid` (the thought showing now), so the same one never shows twice in a
 * row. Returns the thought and the seen ids after it.
 */
export function pickThought(list: ReadonlyArray<ThoughtEntry>, seen: ReadonlyArray<string>, random: number, avoid: ReadonlyArray<string> = []): { readonly thought: HomeThought; readonly seen: ReadonlyArray<string> } | undefined {
  const known = new Set(list.map((entry) => thoughtId(entry.text)))
  const kept = seen.filter((id) => known.has(id))
  const seenSet = new Set(kept)
  let pool = list.filter((entry) => !seenSet.has(thoughtId(entry.text)))
  let after = kept
  if (pool.length === 0) {
    const avoided = new Set(avoid)
    pool = list.filter((entry) => !avoided.has(thoughtId(entry.text)))
    after = []
    if (pool.length === 0) pool = [...list]
  }
  const entry = pool[Math.min(pool.length - 1, Math.floor(random * pool.length))]
  if (entry === undefined) return undefined
  return { thought: shown(entry), seen: [...after, thoughtId(entry.text)] }
}

let loaded: ReadonlyArray<ThoughtEntry> | undefined
let loading: Promise<ReadonlyArray<ThoughtEntry>> | undefined

/** The list, from its own chunk, once. */
function loadList(): Promise<ReadonlyArray<ThoughtEntry>> {
  loading ??= import('./homeThoughtList').then((module) => (loaded = module.HOME_THOUGHTS))
  return loading
}

/** Settings › General, "Show a thought when Home is empty". On by default. */
export const homeThoughtsOnAtom = Atom.make<boolean>(read().off !== true).pipe(Atom.keepAlive)

export function setHomeThoughtsOn(registry: Registry, on: boolean): void {
  const saved = read()
  const { off: _off, ...rest } = saved
  write(on ? rest : { ...rest, off: true })
  registry.set(homeThoughtsOnAtom, on)
}

/**
 * The thought for a Home appearing now with no rows: the one showing if it
 * was taken less than `SAME_THOUGHT_MILLIS` ago, else the saved next one,
 * else one from the list if it has loaded. `pending` when the list has to
 * load first (only before any thought was ever saved); undefined when
 * thoughts are off.
 */
export function takeThought(now: number): HomeThought | 'pending' | undefined {
  const saved = read()
  if (saved.off === true) return undefined
  if (saved.current !== undefined && now - saved.current.at < SAME_THOUGHT_MILLIS && now >= saved.current.at) return saved.current.thought
  if (saved.next !== undefined) {
    const { next, ...rest } = saved
    write({ ...rest, current: { thought: next, at: now } })
    return next
  }
  if (loaded === undefined) return 'pending'
  const picked = pickThought(loaded, saved.seen, Math.random(), saved.current === undefined ? [] : [thoughtId(saved.current.thought.text)])
  if (picked === undefined) return undefined
  write({ ...saved, seen: picked.seen, current: { thought: picked.thought, at: now } })
  return picked.thought
}

/** Loads the list and saves the next thought if none is saved, so the next Home has it in its first frame. */
export async function prepareThought(): Promise<void> {
  const list = await loadList()
  const saved = read()
  if (saved.next !== undefined || saved.off === true) return
  const picked = pickThought(list, saved.seen, Math.random(), saved.current === undefined ? [] : [thoughtId(saved.current.thought.text)])
  if (picked !== undefined) write({ ...saved, seen: picked.seen, next: picked.thought })
}

/** The thought for a Home that was `pending`: once the list has loaded, taken as of `now`. */
export async function pendingThought(now: number): Promise<HomeThought | undefined> {
  await loadList()
  const taken = takeThought(now)
  void prepareThought()
  return taken === 'pending' ? undefined : taken
}
