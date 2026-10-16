/**
 * Images that reach the store before Slack has made their thumbnails
 * (research section 3, "Files"). Live, the echo of a freshly shared image
 * carries no `thumb_*` and no `original_w`/`original_h`, and nothing later
 * changes the message: Slack sends `file_thumbnail_generated` with the urls
 * but no sizes. So the sync asks `files.info` for such a file and writes its
 * thumbnails into every stored message that carries it (`run/files.ts`,
 * `write/files.ts`).
 *
 * Thumbnails only ever arrive: a later copy of the message without them
 * (an echo, a page requested earlier) keeps the stored ones (`keepThumbs`).
 */
export type FileJson = { readonly [key: string]: unknown }

const isThumbKey = (key: string): boolean => key.startsWith('thumb_') || key === 'original_w' || key === 'original_h'

/** Slack's thumbnail and the size the list needs to lay it out. */
export const hasThumbs = (file: FileJson): boolean =>
  (typeof file['thumb_360'] === 'string' || typeof file['thumb_480'] === 'string' || typeof file['thumb_720'] === 'string') &&
  ((typeof file['original_w'] === 'number' && typeof file['original_h'] === 'number') || (typeof file['thumb_360_w'] === 'number' && typeof file['thumb_360_h'] === 'number'))

/** An image Slack holds and may still make thumbnails for. */
const isHostedImage = (file: FileJson): boolean =>
  typeof file['id'] === 'string' &&
  typeof file['mimetype'] === 'string' &&
  file['mimetype'].startsWith('image/') &&
  file['mode'] !== 'tombstone' &&
  file['mode'] !== 'external' &&
  file['file_access'] !== 'file_not_found'

export const parseFiles = (json: string | null): ReadonlyArray<FileJson> | undefined => {
  if (json === null) return undefined
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? (value as ReadonlyArray<FileJson>) : undefined
  } catch {
    return undefined
  }
}

/** The ids of a message's images that have no thumbnails yet. */
export function imagesWithoutThumbs(filesJson: string | null): ReadonlyArray<string> {
  return (parseFiles(filesJson) ?? []).filter((file) => isHostedImage(file) && !hasThumbs(file)).map((file) => file['id'] as string)
}

/** `incoming` files, where one without thumbnails takes the stored copy's, so a later copy of the message never takes them away. */
export function keepThumbs(stored: string | null, incoming: string | null): string | null {
  if (stored === null || incoming === null || stored === incoming) return incoming
  const before = parseFiles(stored)
  const after = parseFiles(incoming)
  if (before === undefined || after === undefined) return incoming
  let changed = false
  const merged = after.map((file) => {
    if (hasThumbs(file)) return file
    const held = before.find((each) => each['id'] === file['id'] && hasThumbs(each))
    if (held === undefined) return file
    changed = true
    return { ...file, ...thumbsOf(held) }
  })
  return changed ? JSON.stringify(merged) : incoming
}

export const thumbsOf = (file: FileJson): FileJson => Object.fromEntries(Object.entries(file).filter(([key]) => isThumbKey(key)))
