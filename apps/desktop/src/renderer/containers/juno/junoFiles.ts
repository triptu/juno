/**
 * Files for Juno (SPEC 12 "Writing", 13.1), read here, where Chromium
 * decodes images. Each image is turned upright, scaled to fit
 * `JUNO_IMAGE_LIMITS` and encoded again, which also drops its metadata
 * (such as where a photo was taken), with a small thumbnail for the
 * bubble. A text file is read and cut to its limit. Each file is read once,
 * by its chip id, starting as soon as Juno is where the draft goes, so a
 * send does not wait. Nothing here goes to Slack: the files go to the agent,
 * and from there to the chat model only.
 */
import {
  filesLeftCopy,
  cutText,
  JUNO_TEXT_LIMITS,
  junoFileKind,
  junoTakes,
  type JunoFileInput,
  type JunoLeft,
} from '@juno/agent-contract'
import { useEffect, useState } from 'react'
import { attachedFiles, attachLocal, attachmentsAtom, registry, removeAttachment, settleLocal, type Attachment } from '@juno/state'
import { junoReadsImagesAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'
import { chunk } from '../chunks'
import { preloadAfterSidebar } from '../preloadAfterSidebar'

const reader = chunk(() => import('./junoFileRead'))

const read = new Map<string, Promise<JunoFileInput | undefined>>()

/** Reads one attached file for Juno, once. Undefined when it cannot be read (an image Chromium cannot decode, a binary file). */
export function readForJuno(attachment: Pick<Attachment, 'id' | 'name' | 'mimetype'>): Promise<JunoFileInput | undefined> {
  const known = read.get(attachment.id)
  if (known !== undefined) return known
  const file = attachedFiles.get(attachment.id) as Blob | undefined
  const kind = junoFileKind(attachment.mimetype, attachment.name)
  const reading =
    file === undefined || kind === 'other'
      ? Promise.resolve(undefined)
      : reader.load().then((module) => module.readFile(file, attachment.name, attachment.mimetype)).catch(() => undefined)
  read.set(attachment.id, reading)
  return reading
}

const isImage = (file: { readonly type: string; readonly name: string }) => junoFileKind(file.type, file.name) === 'image'

/**
 * Attaches files in a composer only Juno reads (the Juno tab and the
 * panel): nothing is staged in the engine. An image's chip is its picture
 * from its first frame: a chip-sized copy, decoded before the chip is
 * added, so it never shows as a file chip or an empty square first. The
 * chip says when the image could not be read.
 */
export function attachToJuno(key: string, files: ReadonlyArray<File>): void {
  void Promise.all(files.map((file) => (isImage(file) ? reader.load().then((module) => module.previewOf(file)) : undefined))).then((previews) => {
    const added = attachLocal(registry, key, files, isImage, (file) => previews[files.indexOf(file as File)])
    for (const chip of added) {
      if (chip.state !== 'staging') continue
      void readForJuno(chip).then((input) => settleLocal(registry, key, chip.id, input?._tag === 'image' ? {} : 'failed'))
    }
  })
}

/** The files a send to Juno took leave the composer; staged bytes, if any, are deleted. */
export function leaveComposer(key: string, ids: ReadonlyArray<string>): void {
  for (const id of ids) {
    removeAttachment(registry, key, id)
    read.delete(id)
  }
}

/**
 * Juno's side of a composer's files, while Juno is where the draft goes
 * (`active`): the files Juno takes are read at once, and `note` says why
 * any others stay. `hasFiles` when a send would carry some.
 */
export function useJunoFiles(key: string, files: ReadonlyArray<Attachment>, active: boolean, where: 'home' | 'chat') {
  useEffect(() => preloadAfterSidebar(() => void reader.load()), [])
  const readsImages = useAtomValue(junoReadsImagesAtom)
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (!active) return
    let live = true
    for (const chip of junoTakes(files.filter((file) => file.state === 'ready'), readsImages).taken) {
      void readForJuno(chip).then((input) => {
        if (live && input === undefined) setFailed((before) => new Set(before).add(chip.id))
      })
    }
    return () => {
      live = false
    }
  }, [files, active, readsImages])
  if (!active) return { readsImages, note: undefined, hasFiles: false }
  const usable = files.filter((file) => file.state !== 'failed')
  const { taken, left } = junoTakes(usable.filter((file) => !failed.has(file.id)), readsImages)
  const all: ReadonlySet<JunoLeft> = usable.some((file) => failed.has(file.id)) ? new Set([...left, 'other' as const]) : left
  return { readsImages, note: leftNote(all, where), hasFiles: taken.length > 0 }
}

/** The line under the files a send to Juno leaves (`filesLeftCopy`). `home` can name a person or channel. */
export function leftNote(left: ReadonlySet<JunoLeft>, where: 'home' | 'chat'): string | undefined {
  const copy = filesLeftCopy
  const lines = [
    left.has('images') ? copy.images : undefined,
    left.has('other') ? (where === 'home' ? copy.other : copy.otherHere) : undefined,
    left.has('more') ? copy.more : undefined,
  ].filter((line) => line !== undefined)
  return lines.length === 0 ? undefined : lines.join(' ')
}

/** Chip ids a send is taking now, so a second send while the first waits for a read does not take them again. */
const taking = new Set<string>()

/**
 * What a send to Juno takes from the composer of `key`: the files read for
 * it, with the text files cut to fit `JUNO_TEXT_LIMITS.total` together,
 * and the chip ids that leave. A chip still being read (`staging`, in the
 * Juno chat) is waited for. Files Juno cannot read stay.
 */
export async function takeForJuno(key: string, readsImages: boolean): Promise<{ readonly files: ReadonlyArray<JunoFileInput>; readonly ids: ReadonlyArray<string> }> {
  const chips = registry.get(attachmentsAtom(key)).filter((chip) => chip.state !== 'failed' && !taking.has(chip.id))
  const { taken } = junoTakes(chips, readsImages)
  for (const chip of taken) taking.add(chip.id)
  const results = await Promise.all(taken.map(async (chip) => ({ chip, input: await readForJuno(chip) }))).finally(() => {
    for (const chip of taken) taking.delete(chip.id)
  })
  let room = JUNO_TEXT_LIMITS.total
  const files: JunoFileInput[] = []
  const ids: string[] = []
  for (const { chip, input } of results) {
    if (input === undefined) continue
    if (input._tag === 'text') {
      if (room <= 0) continue
      const kept = cutText(input.text, room)
      room -= new TextEncoder().encode(kept.text).length
      files.push({ ...input, text: kept.text, cut: input.cut || kept.cut })
    } else {
      files.push(input)
    }
    ids.push(chip.id)
  }
  return { files, ids }
}
