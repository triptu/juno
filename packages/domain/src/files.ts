/**
 * What a Slack file is, for showing it: an image, a video, audio, a PDF or
 * any other file. Slack fills a fresh upload's type in as it processes the
 * file, so the type is read from `mimetype` when Slack has one, else from
 * Slack's short `filetype`, else from the name's extension. A pasted
 * screenshot named `x.png` is an image from its first copy, before Slack
 * says so.
 */

export type FileMediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'file'

/** The fields of a file the kind is read from; every one may be missing. */
export interface TypedFile {
  readonly mimetype?: string | undefined
  readonly filetype?: string | undefined
  readonly name?: string | null | undefined
  readonly title?: string | null | undefined
}

/** `mimetype` when Slack has worked it out: set and not empty. */
export function knownMimetype(file: TypedFile): string | undefined {
  const type = file.mimetype?.trim().toLowerCase()
  return type === undefined || type === '' ? undefined : type
}

/** The kind a file shows as; `file` when nothing says more. The generic binary type says nothing, so the name decides. */
export function fileMediaKind(file: TypedFile): FileMediaKind {
  const mimetype = knownMimetype(file)
  if (mimetype !== undefined && mimetype !== 'application/octet-stream') return kindOfMimetype(mimetype)
  const filetype = file.filetype?.trim().toLowerCase()
  if (filetype !== undefined && filetype !== '') return KINDS_BY_TYPE[filetype] ?? 'file'
  return KINDS_BY_TYPE[extensionOf(file.name) ?? extensionOf(file.title) ?? ''] ?? 'file'
}

function kindOfMimetype(mimetype: string): FileMediaKind {
  if (mimetype === 'application/pdf') return 'pdf'
  const family = mimetype.split('/')[0]
  return family === 'image' || family === 'video' || family === 'audio' ? family : 'file'
}

function extensionOf(name: string | null | undefined): string | undefined {
  if (name === undefined || name === null) return undefined
  const dot = name.lastIndexOf('.')
  return dot === -1 ? undefined : name.slice(dot + 1).trim().toLowerCase()
}

/** Slack's short `filetype` values and common extensions, by kind. */
const KINDS_BY_TYPE: Readonly<Record<string, FileMediaKind>> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', tif: 'image', tiff: 'image', heic: 'image', heif: 'image', svg: 'image', avif: 'image',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', mkv: 'video', avi: 'video', mpg: 'video', mpeg: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio', aiff: 'audio',
  pdf: 'pdf',
}
