/**
 * Files that reach the store before Slack has everything a message needs to
 * show them (research section 3, "Files"). Seen live: the echo of a freshly
 * shared image carries no `thumb_*` and no `original_w`/`original_h`, Slack
 * then sends `file_shared`, `file_change` or `file_thumbnail_generated` with
 * the file's id alone, and nothing changes the message itself. A video's
 * poster (`thumb_video` and its size) can come late the same way. A socket
 * message can also carry a partial file, `file_access: "check_file_info"`
 * with little more than its id. So the sync tries `files.info`, then re-reads the message if it fails or
 * is not ready, and writes the processed copy into every stored message that carries it
 * (`run/files.ts`, `write/files.ts`).
 *
 * Slack also fills a fresh upload's type in as it processes the file: a copy
 * with no `mimetype`, or an empty one, is not complete, and its
 * kind is read from Slack's `filetype` or the name meanwhile (`fileMediaKind`
 * in `@juno/domain`), so a pasted screenshot is an image from its first copy.
 *
 * What a message shows only ever gets fuller: a later copy without a file's
 * thumbnails, poster or playback url keeps the stored ones, and a partial
 * copy never replaces a complete one (`keepFuller`).
 */
import { fileMediaKind, knownMimetype, type TypedFile } from '@juno/domain'

export type FileJson = { readonly [key: string]: unknown }

/** The keys that make an image or video show inline. */
const isMediaKey = (key: string): boolean => key.startsWith('thumb_') || key === 'original_w' || key === 'original_h' || key === 'mp4' || key === 'hls'

/** `files.info` keys about where the file is shared, which a message does not keep. */
const SHARE_KEYS = new Set(['channels', 'groups', 'ims', 'shares', 'has_more_shares', 'comments_count', 'favorites'])

/** Slack's thumbnail and the size the list needs to lay it out. */
export const hasThumbs = (file: FileJson): boolean =>
  (typeof file['thumb_360'] === 'string' || typeof file['thumb_480'] === 'string' || typeof file['thumb_720'] === 'string') &&
  ((typeof file['original_w'] === 'number' && typeof file['original_h'] === 'number') || (typeof file['thumb_360_w'] === 'number' && typeof file['thumb_360_h'] === 'number'))

/** A video's poster frame with its size, which the list lays the player out from. */
const hasPoster = (file: FileJson): boolean => typeof file['thumb_video'] === 'string' && typeof file['thumb_video_w'] === 'number' && typeof file['thumb_video_h'] === 'number'

/** A copy that says what the file is: Slack has worked out its type, and it is not the partial `check_file_info` shape. */
const isComplete = (file: FileJson): boolean => file['file_access'] !== 'check_file_info' && knownMimetype(typed(file)) !== undefined

const mediaKind = (file: FileJson): 'image' | 'video' | undefined => {
  const kind = fileMediaKind(typed(file))
  return kind === 'image' || kind === 'video' ? kind : undefined
}

/** The fields of a stored file its kind is read from, as strings or nothing: a voice clip's `subtype` and a snippet's `mode` say more than its type. */
const typed = (file: FileJson): TypedFile => ({
  mimetype: str(file['mimetype']),
  filetype: str(file['filetype']),
  name: str(file['name']),
  title: str(file['title']),
  subtype: str(file['subtype']),
  mode: str(file['mode']),
})

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** Everything the list needs to show the file: complete, and an image's thumbnails or a video's poster. */
export const isReady = (file: FileJson): boolean => {
  if (!isComplete(file)) return false
  const kind = mediaKind(file)
  return kind === 'image' ? hasThumbs(file) : kind === 'video' ? hasPoster(file) : true
}

/** A file Slack holds and may still fill in; deleted and external files never will. */
const mayFillIn = (file: FileJson): boolean =>
  typeof file['id'] === 'string' && file['mode'] !== 'tombstone' && file['mode'] !== 'external' && file['file_access'] !== 'file_not_found'

export const parseFiles = (json: string | null): ReadonlyArray<FileJson> | undefined => {
  if (json === null) return undefined
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? (value as ReadonlyArray<FileJson>) : undefined
  } catch {
    return undefined
  }
}

/** The ids of a message's files that are not ready to show and that a message re-read may fill in. */
export function filesToFetch(filesJson: string | null): ReadonlyArray<string> {
  return (parseFiles(filesJson) ?? []).filter((file) => mayFillIn(file) && !isReady(file)).map((file) => file['id'] as string)
}

/** The ids of a message's images that have no thumbnails yet: the ones a sent image's staged copy stands in for. */
export function imagesWithoutThumbs(filesJson: string | null): ReadonlyArray<string> {
  return (parseFiles(filesJson) ?? []).filter((file) => mayFillIn(file) && mediaKind(file) === 'image' && !hasThumbs(file)).map((file) => file['id'] as string)
}

/**
 * `incoming` files, each no emptier than the stored copy: a partial copy
 * keeps the complete stored one, and one without thumbnails, a poster or a
 * playback url takes the stored copy's.
 */
export function keepFuller(stored: string | null, incoming: string | null): string | null {
  if (stored === null || incoming === null || stored === incoming) return incoming
  const before = parseFiles(stored)
  const after = parseFiles(incoming)
  if (before === undefined || after === undefined) return incoming
  let changed = false
  const merged = after.map((file) => {
    const held = before.find((each) => each['id'] === file['id'])
    if (held === undefined) return file
    if (!isComplete(file) && isComplete(held)) {
      changed = true
      return held
    }
    const missing = Object.entries(mediaOf(held)).filter(([key]) => file[key] === undefined)
    if (missing.length === 0) return file
    changed = true
    return { ...file, ...Object.fromEntries(missing) }
  })
  return changed ? JSON.stringify(merged) : incoming
}

/** A file's thumbnails, poster, size and playback urls. */
const mediaOf = (file: FileJson): FileJson => Object.fromEntries(Object.entries(file).filter(([key]) => isMediaKey(key)))

/** `files.info`'s file as a message keeps it: without where it is shared. */
export const asMessageFile = (info: FileJson): FileJson => Object.fromEntries(Object.entries(info).filter(([key]) => !SHARE_KEYS.has(key)))
