/**
 * The images and text files an owner message gives Juno (SPEC 12, 13.1).
 *
 * They are stored with the inbox op, in `inbox_files`, in the transaction
 * that accepts it. The model reads them in the run the message arrives in:
 * images as image parts of its user message, text files inside it as
 * `<file>` elements. The words say where each image was:
 *
 *   <message id="n12"><image n="0" name="chart.png" width="1200" height="800"/>what does this show?</message>
 *
 * The archive keeps that text, so a later run knows an image was there but
 * does not get it again (the request builder sends pi's messages for the
 * current run only). Once the run is done the bodies are cleared; a run
 * that was interrupted or failed keeps them for Try again. The thumbnails
 * stay for the bubble until a removal deletes the rows.
 */
import { imageSize, JUNO_IMAGE_LIMITS, JUNO_TEXT_LIMITS, ownerFilesOf, type JunoFileInput, type OwnerFile } from '@juno/agent-contract'
import type { InputContent } from '../runtime/journal'
import type { Store } from '../store/store'

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Whether an image is what it says: a PNG, JPEG, GIF or WebP of its size, within the limits. */
function validImage(file: Extract<JunoFileInput, { _tag: 'image' }>): boolean {
  const bytes = Buffer.from(file.data, 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > JUNO_IMAGE_LIMITS.bytes) return false
  const size = imageSize(bytes)
  return size !== undefined && size.width === file.width && size.height === file.height && size.width * size.height <= JUNO_IMAGE_LIMITS.pixels * 1.01
}

/** The files a send keeps: valid images and text files, within the counts and the text total. */
export function admittedFiles(files: ReadonlyArray<JunoFileInput>): ReadonlyArray<JunoFileInput> {
  let images = 0
  let texts = 0
  let textBytes = 0
  return files.filter((file) => {
    if (file._tag === 'image') return validImage(file) && ++images <= JUNO_IMAGE_LIMITS.count
    const bytes = Buffer.byteLength(file.text, 'utf8')
    if (++texts > JUNO_TEXT_LIMITS.count || textBytes + bytes > JUNO_TEXT_LIMITS.total) return false
    textBytes += bytes
    return true
  })
}

/** Writes a send's files; call inside the inbox transaction. Returns what the bubble shows. */
export function storeFiles(store: Store, opId: string, files: ReadonlyArray<JunoFileInput>): ReadonlyArray<OwnerFile> {
  const insert = store.db.prepare('INSERT OR IGNORE INTO inbox_files (op_id, n, kind, mime, thumb, body) VALUES (?, ?, ?, ?, ?, ?)')
  files.forEach((file, n) => {
    if (file._tag === 'image') insert.run(opId, n, 'image', file.mimeType, file.thumb, file.data)
    else insert.run(opId, n, 'text', file.cut ? 'cut' : null, null, file.text)
  })
  return ownerFilesOf(files)
}

/** Try again: the new op gets the files of the one it resends. */
export function copyFiles(store: Store, from: string, to: string): void {
  store.db.prepare('INSERT OR IGNORE INTO inbox_files (op_id, n, kind, mime, thumb, body) SELECT ?, n, kind, mime, thumb, body FROM inbox_files WHERE op_id = ?').run(to, from)
}

/** A done run's inputs no longer need their bodies. */
export function clearBodies(store: Store, opIds: ReadonlyArray<string>): void {
  const clear = store.db.prepare('UPDATE inbox_files SET body = NULL WHERE op_id = ? AND body IS NOT NULL')
  for (const opId of opIds) clear.run(opId)
}

/** A removal takes the files with the message. */
export function deleteFiles(store: Store, opIds: ReadonlyArray<string>): void {
  const remove = store.db.prepare('DELETE FROM inbox_files WHERE op_id = ?')
  for (const opId of opIds) remove.run(opId)
}

/** An image's thumbnail for the bubble, or undefined once removed. */
export function thumbOf(store: Store, opId: string, n: number): string | undefined {
  const row = store.db.prepare("SELECT thumb FROM inbox_files WHERE op_id = ? AND n = ? AND kind = 'image'").get(opId, n) as { thumb: string | null } | undefined
  return row?.thumb ?? undefined
}

type Row = { n: number; kind: 'image' | 'text'; mime: string | null; body: string | null }

const rowsOf = (store: Store, opId: string) =>
  store.db.prepare('SELECT n, kind, mime, body FROM inbox_files WHERE op_id = ? ORDER BY n').all(opId) as unknown as Row[]

/** The `<image>` and `<file>` elements for a message's files, in the order they were attached. */
export function fileElements(store: Store, opId: string, files: ReadonlyArray<OwnerFile>): string {
  const bodies = new Map(rowsOf(store, opId).map((row) => [row.n, row]))
  return files
    .map((file) => {
      const name = escape(file.name)
      if (file._tag === 'image') return `<image n="${file.n}" name="${name}" width="${file.width}" height="${file.height}"/>`
      const row = bodies.get(file.n)
      return `<file name="${name}"${row?.mime === 'cut' ? ' cut="true"' : ''}>${escape(row?.body ?? '')}</file>`
    })
    .join('')
}

/** What pi receives for a message: its text, then its images as image parts. Text alone when it has none left. */
export function withImages(store: Store, opId: string, text: string): InputContent {
  const images = rowsOf(store, opId).filter((row) => row.kind === 'image' && row.body !== null && row.mime !== null)
  if (images.length === 0) return text
  return [{ type: 'text', text }, ...images.map((row) => ({ type: 'image' as const, data: row.body!, mimeType: row.mime! }))]
}
