/**
 * Home's picture (SPEC 12, "A picture") and the gallery's files ("Pictures
 * and the gallery").
 *
 * - Only what Home's first frame needs loads with it: this file reads local
 *   storage. Picking, downloading and the catalog are `pictureFiles.ts`, a
 *   chunk loaded when idle after Home paints (`preparePicture`) and when the
 *   gallery opens, so they never grow the start bundle.
 * - A picture shows only when its file is on this Mac. `preparePicture`
 *   picks the next one, has the engine download it, and only then saves it
 *   as next, with what the caption needs, so Home has it in its first frame
 *   with no catalog and no network.
 * - This Mac keeps in local storage whether pictures show (Settings ›
 *   General), the pictures shown, the one showing and the next one. A Home
 *   within `SAME_PICTURE_MILLIS` of taking its picture shows the same one;
 *   none repeats until all have shown.
 */
import * as Atom from 'effect/reactivity/Atom'
import type { PictureSize } from '@juno/contract'
import { pictureFile, type PictureLabel } from '@juno/pictures'
import type { Registry } from './client'

/** A Home that comes back within this long of taking its picture shows the same one. */
export const SAME_PICTURE_MILLIS = 10 * 60_000

const STORAGE_KEY = 'juno.homePictures'

export interface Saved {
  /** Settings › General, "Show a picture when you are caught up", turned off. */
  readonly off?: boolean
  /** Ids of the pictures shown since the list last started over, the next one included. */
  readonly seen: ReadonlyArray<string>
  readonly current?: { readonly label: PictureLabel; readonly at: number }
  /** On disk, ready for the next caught-up Home. */
  readonly next?: PictureLabel
}

/** The part of `Storage` used here; the state package has no DOM types. */
interface PictureStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const memory = new Map<string, string>()
const storage = (): PictureStorage =>
  (globalThis as { readonly localStorage?: PictureStorage }).localStorage ?? { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value) }

function isLine(value: unknown): value is PictureLabel['line'] {
  if (typeof value !== 'object' || value === null) return false
  const { text, by } = value as Record<string, unknown>
  return typeof text === 'string' && (by === undefined || typeof by === 'string')
}

/** A saved label from before pictures had a line has none: it is dropped, and Home shows its scene until the next picture is ready. */
function isLabel(value: unknown): value is PictureLabel {
  if (typeof value !== 'object' || value === null) return false
  const { id, title, artist, date, ratio, line } = value as Record<string, unknown>
  return typeof id === 'string' && typeof title === 'string' && typeof artist === 'string' && typeof date === 'string' && typeof ratio === 'number' && ratio > 0 && isLine(line)
}

/** What this Mac keeps about Home's pictures. */
export function readPictures(): Saved {
  try {
    const value: unknown = JSON.parse(storage().getItem(STORAGE_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null) return { seen: [] }
    const raw = value as { off?: unknown; seen?: unknown; current?: { label?: unknown; at?: unknown }; next?: unknown }
    return {
      ...(raw.off === true ? { off: true } : {}),
      seen: Array.isArray(raw.seen) ? raw.seen.filter((id): id is string => typeof id === 'string') : [],
      ...(isLabel(raw.current?.label) && typeof raw.current.at === 'number' ? { current: { label: raw.current.label, at: raw.current.at } } : {}),
      ...(isLabel(raw.next) ? { next: raw.next } : {}),
    }
  } catch {
    return { seen: [] }
  }
}

export function writePictures(saved: Saved): void {
  try {
    storage().setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Storage full or unavailable: Home shows its scene.
  }
}

/** Where the renderer reads a picture's file: main serves it from the engine's cache. */
export const pictureUrl = (id: string, size: PictureSize): string => `juno://pictures/${pictureFile(id, size)}`

/** Settings › General, "Show a picture when you are caught up". On by default. */
export const homePicturesOnAtom = Atom.make<boolean>(readPictures().off !== true).pipe(Atom.keepAlive)

export function setHomePicturesOn(registry: Registry, on: boolean): void {
  const { off: _off, ...rest } = readPictures()
  writePictures(on ? rest : { ...rest, off: true })
  registry.set(homePicturesOnAtom, on)
}

/**
 * The picture for a caught-up Home appearing now: the one showing if it was
 * taken less than `SAME_PICTURE_MILLIS` ago, else the saved next one, which
 * is on disk. Undefined when pictures are off or none is ready: Home shows
 * its scene.
 */
export function takePicture(now: number): PictureLabel | undefined {
  const saved = readPictures()
  if (saved.off === true) return undefined
  if (saved.current !== undefined && now - saved.current.at < SAME_PICTURE_MILLIS && now >= saved.current.at) return saved.current.label
  if (saved.next === undefined) return undefined
  const { next, ...rest } = saved
  writePictures({ ...rest, current: { label: next, at: now } })
  return next
}

/** The picture Home showed last, for the gallery's ring. */
export const lastPictureId = (): string | undefined => readPictures().current?.label.id

/** Home's picture would not load (its file is gone): it is not shown again until it is downloaded again. */
export function forgetPicture(id: string): void {
  const saved = readPictures()
  const { current, next, ...rest } = saved
  writePictures({ ...rest, ...(current === undefined || current.label.id === id ? {} : { current }), ...(next === undefined || next.id === id ? {} : { next }) })
}

/** Titles by id, once the catalog has loaded, for a picture tab's title. */
const titles = new Map<string, string>()

export function rememberTitles(pictures: ReadonlyArray<{ readonly id: string; readonly title: string }>): void {
  for (const picture of pictures) titles.set(picture.id, picture.title)
}

/** A picture's title for its tab, once the catalog has loaded or when it is Home's picture. */
export function pictureTitle(id: string): string | undefined {
  const current = readPictures().current
  return titles.get(id) ?? (current?.label.id === id ? current.label.title : undefined)
}

/**
 * Picks and downloads the next picture when idle after Home paints, from the lazy `pictureFiles.ts`
 * (`prepareNextPicture`), so the next caught-up Home has it on disk in its first frame.
 */
export function preparePicture(registry: Registry, now: Date): Promise<void> {
  return import('./pictureFiles').then((module) => module.prepareNextPicture(registry, now))
}
