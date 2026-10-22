/**
 * Home's picture files and the catalog (SPEC 12,
 * "A picture" and "Pictures and the gallery"): a chunk of its own, loaded when
 * idle after Home paints and when the gallery opens. `homePictures.ts` is the
 * part Home's first frame needs.
 */
import * as Atom from 'effect/reactivity/Atom'
import { picturesFetch, picturesOnDisk, type PictureSize } from '@juno/contract'
import { fitsHome, isLateNight, labelOf, pickPicture, type Picture } from '@juno/pictures'
import { runCommand } from './atoms'
import type { Registry } from './client'
import { readPictures, rememberTitles, writePictures } from './homePictures'

let catalog: Promise<ReadonlyArray<Picture>> | undefined
let loaded: ReadonlyArray<Picture> | undefined

/** The catalog, from its own chunk, once. */
export function loadPictures(): Promise<ReadonlyArray<Picture>> {
  catalog ??= import('@juno/pictures/catalog').then((module) => {
    rememberTitles(module.PICTURES)
    loaded = module.PICTURES
    return module.PICTURES
  })
  return catalog
}

/** The catalog once it has loaded, so a page can draw in the same render instead of suspending on a settled promise. */
export const loadedPictures = (): ReadonlyArray<Picture> | undefined => loaded


/** The files on disk, as `<id>-<size>`, so the gallery shows a picture as soon as it has it. */
export const pictureFilesAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)

const fileKey = (id: string, size: PictureSize) => `${id}-${size}`

function addFiles(registry: Registry, keys: ReadonlyArray<string>): void {
  const files = registry.get(pictureFilesAtom)
  if (keys.every((key) => files.has(key))) return
  registry.set(pictureFilesAtom, new Set([...files, ...keys]))
}

/** A file Home showed from disk, so the picture page it opens has it in its first frame. */
export function notePicture(registry: Registry, id: string, size: PictureSize): void {
  addFiles(registry, [fileKey(id, size)])
}

/** Has the engine download one file unless it is on disk; true when it is there. */
export async function ensurePicture(registry: Registry, id: string, size: PictureSize): Promise<boolean> {
  if (registry.get(pictureFilesAtom).has(fileKey(id, size))) return true
  const exit = await runCommand(registry, picturesFetch, { id, size })
  const there = exit._tag === 'Success' && exit.value
  if (there) addFiles(registry, [fileKey(id, size)])
  return there
}

/** Reads which files are on disk, for the gallery's first frame. */
export async function readPictureFiles(registry: Registry, size: PictureSize): Promise<void> {
  const exit = await runCommand(registry, picturesOnDisk, { size })
  if (exit._tag === 'Success') addFiles(registry, exit.value.map((id) => fileKey(id, size)))
}

let preparing: Promise<void> | undefined

/** The next picture: one on disk and not shown yet when there is one, else any by the usual rotation. */
async function pickNext(registry: Registry, list: ReadonlyArray<Picture>, saved: ReturnType<typeof readPictures>, night: boolean) {
  const exit = await runCommand(registry, picturesOnDisk, { size: 'small' })
  const there = new Set(exit._tag === 'Success' ? exit.value : [])
  const seen = new Set(saved.seen)
  const ready = list.filter((picture) => there.has(picture.id) && fitsHome(picture) && !seen.has(picture.id) && picture.id !== saved.current?.label.id)
  const fromDisk = ready.length === 0 ? undefined : pickPicture(ready, [], Math.random(), { night })
  if (fromDisk !== undefined) return { picture: fromDisk.picture, seen: [...saved.seen, fromDisk.picture.id] }
  return pickPicture(list, saved.seen, Math.random(), { night, ...(saved.current === undefined ? {} : { avoid: [saved.current.label.id] }) })
}

/**
 * Picks the next picture if none is saved, has the engine download both
 * its files, and saves it as next once the small one is on disk, so the
 * next caught-up Home has it in its first frame. A picture not shown yet
 * that is on disk already (the gallery downloaded it) comes first, so it
 * is saved at once. Late at night the next is a picture that suits the
 * night. A failed download saves nothing; the next Home tries again.
 */
export function prepareNextPicture(registry: Registry, now: Date): Promise<void> {
  preparing ??= (async () => {
    const saved = readPictures()
    if (saved.off === true) return
    const list = await loadPictures()
    const night = isLateNight(now)
    const picked = saved.next === undefined ? await pickNext(registry, list, saved, night) : undefined
    const label = saved.next ?? (picked === undefined ? undefined : labelOf(picked.picture))
    if (label === undefined) return
    if (!(await ensurePicture(registry, label.id, 'small'))) return
    void ensurePicture(registry, label.id, 'large')
    const latest = readPictures()
    if (latest.off === true || latest.next !== undefined) return
    writePictures({ ...latest, seen: picked?.seen ?? latest.seen, next: label })
  })().finally(() => {
    preparing = undefined
  })
  return preparing
}
