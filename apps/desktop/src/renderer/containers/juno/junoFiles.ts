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
  chatCopy,
  cutText,
  fitImage,
  JUNO_IMAGE_LIMITS,
  JUNO_TEXT_LIMITS,
  JUNO_THUMB_CHARS,
  JUNO_THUMB_EDGE,
  junoFileKind,
  junoTakes,
  type JunoFileInput,
  type JunoLeft,
} from '@juno/agent-contract'
import { useEffect, useState } from 'react'
import { attachedFiles, attachLocal, attachmentsAtom, registry, removeAttachment, settleLocal, type Attachment } from '@juno/state'
import { junoReadsImagesAtom } from '@juno/state/agent'
import { useAtomValue } from '@juno/state/react'

const read = new Map<string, Promise<JunoFileInput | undefined>>()

/** A data URL's or a blob's base64, through the browser's own encoder. */
const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

async function encode(bitmap: ImageBitmap, width: number, height: number, type: string, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d context')
  // JPEG has no transparency: what was clear becomes white, as a page behind it would be.
  if (type === 'image/jpeg') {
    context.fillStyle = 'white'
    context.fillRect(0, 0, width, height)
  }
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  return canvas.convertToBlob({ type, quality })
}

/** PNG stays PNG (screenshots keep their text sharp), a photo is JPEG; too many bytes goes to JPEG, then smaller, a quarter at a time. */
async function readImage(file: Blob, name: string, mimetype: string): Promise<JunoFileInput | undefined> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => undefined)
  if (bitmap === undefined) return undefined
  try {
    let size = fitImage(bitmap.width, bitmap.height)
    let blob = await encode(bitmap, size.width, size.height, mimetype === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.85)
    for (let tries = 0; blob.size > JUNO_IMAGE_LIMITS.bytes && tries < 6; tries++) {
      if (tries > 0) size = { width: Math.max(1, Math.floor(size.width * 0.75)), height: Math.max(1, Math.floor(size.height * 0.75)) }
      blob = await encode(bitmap, size.width, size.height, 'image/jpeg', 0.8)
    }
    if (blob.size > JUNO_IMAGE_LIMITS.bytes) return undefined
    const box = fitImage(size.width, size.height, { edge: JUNO_THUMB_EDGE, pixels: Number.POSITIVE_INFINITY })
    let thumb = await dataUrl(await encode(bitmap, box.width, box.height, 'image/webp', 0.8))
    if (thumb.length > JUNO_THUMB_CHARS) thumb = await dataUrl(await encode(bitmap, box.width, box.height, 'image/webp', 0.4))
    if (thumb.length > JUNO_THUMB_CHARS) return undefined
    const data = (await dataUrl(blob)).replace(/^data:[^,]*,/, '')
    return { _tag: 'image', name, mimeType: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', data, width: size.width, height: size.height, thumb }
  } finally {
    bitmap.close()
  }
}

async function readText(file: Blob, name: string): Promise<JunoFileInput | undefined> {
  const text = await file.text()
  // A NUL byte: this is not text, whatever its name says.
  if (text.includes('\u0000')) return undefined
  const kept = cutText(text, JUNO_TEXT_LIMITS.bytes)
  return { _tag: 'text', name, text: kept.text, cut: kept.cut }
}

/** Reads one attached file for Juno, once. Undefined when it cannot be read (an image Chromium cannot decode, a binary file). */
export function readForJuno(attachment: Pick<Attachment, 'id' | 'name' | 'mimetype'>): Promise<JunoFileInput | undefined> {
  const known = read.get(attachment.id)
  if (known !== undefined) return known
  const file = attachedFiles.get(attachment.id) as Blob | undefined
  const kind = junoFileKind(attachment.mimetype, attachment.name)
  const reading =
    file === undefined || kind === 'other'
      ? Promise.resolve(undefined)
      : (kind === 'image' ? readImage(file, attachment.name, attachment.mimetype) : readText(file, attachment.name)).catch(() => undefined)
  read.set(attachment.id, reading)
  return reading
}

/**
 * Attaches files in a composer only Juno reads (the Juno tab and the
 * panel): nothing is staged in the engine. An image's chip shows its
 * thumbnail once it is read, or that it could not be read.
 */
export function attachToJuno(key: string, files: ReadonlyArray<File>): void {
  const added = attachLocal(registry, key, files, (file) => junoFileKind(file.type, file.name) === 'image')
  for (const chip of added) {
    if (chip.state !== 'staging') continue
    void readForJuno(chip).then((input) => settleLocal(registry, key, chip.id, input?._tag === 'image' ? { preview: input.thumb } : 'failed'))
  }
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

/** The line under the files a send to Juno leaves (`chatCopy.composer.filesLeft`). `home` can name a person or channel. */
export function leftNote(left: ReadonlySet<JunoLeft>, where: 'home' | 'chat'): string | undefined {
  const copy = chatCopy.composer.filesLeft
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
