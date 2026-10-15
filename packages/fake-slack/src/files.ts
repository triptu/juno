/**
 * Stored files as Slack describes them: the type from the bytes or the name,
 * the size of an image read from its header, and the file object with the
 * thumbnail sizes Slack would make. Thumbnail urls serve the original bytes.
 */
import type { File } from '@juno/slack-schema'
import type { StoredFile } from './state.ts'

interface FileType {
  readonly mimetype: string
  readonly filetype: string
  readonly pretty: string
}

const TYPES: Readonly<Record<string, FileType>> = {
  png: { mimetype: 'image/png', filetype: 'png', pretty: 'PNG' },
  jpg: { mimetype: 'image/jpeg', filetype: 'jpg', pretty: 'JPEG' },
  jpeg: { mimetype: 'image/jpeg', filetype: 'jpg', pretty: 'JPEG' },
  gif: { mimetype: 'image/gif', filetype: 'gif', pretty: 'GIF' },
  webp: { mimetype: 'image/webp', filetype: 'webp', pretty: 'WebP' },
  svg: { mimetype: 'image/svg+xml', filetype: 'svg', pretty: 'SVG' },
  pdf: { mimetype: 'application/pdf', filetype: 'pdf', pretty: 'PDF' },
  txt: { mimetype: 'text/plain', filetype: 'text', pretty: 'Plain Text' },
  md: { mimetype: 'text/markdown', filetype: 'markdown', pretty: 'Markdown (raw)' },
  csv: { mimetype: 'text/csv', filetype: 'csv', pretty: 'CSV' },
  json: { mimetype: 'application/json', filetype: 'json', pretty: 'JSON' },
  zip: { mimetype: 'application/zip', filetype: 'zip', pretty: 'Zip' },
}

const BINARY: FileType = { mimetype: 'application/octet-stream', filetype: 'binary', pretty: 'Binary' }

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function typeOf(name: string, mimetype: string): FileType {
  const byName = TYPES[extension(name)]
  if (byName?.mimetype === mimetype) return byName
  return Object.values(TYPES).find((t) => t.mimetype === mimetype) ?? byName ?? { ...BINARY, mimetype }
}

/** The image type from the magic bytes, if the bytes are a PNG, JPEG, GIF or WebP. */
function sniffImage(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('latin1', 0, 6))) return 'image/gif'
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

/**
 * The type of uploaded bytes: an image's magic bytes win, then the type the
 * uploader sent, then the name's extension.
 */
export function mimetypeOf(name: string, bytes: Buffer, declared: string | undefined): string {
  const sniffed = sniffImage(bytes)
  if (sniffed !== undefined) return sniffed
  const type = declared?.split(';')[0]?.trim().toLowerCase()
  if (type !== undefined && type !== '' && type !== 'application/octet-stream' && !type.startsWith('multipart/')) return type
  return TYPES[extension(name)]?.mimetype ?? BINARY.mimetype
}

/** Width and height from a PNG, JPEG, GIF or WebP header. */
export function imageSize(bytes: Buffer): { readonly width: number; readonly height: number } | undefined {
  switch (sniffImage(bytes)) {
    case 'image/png':
      return bytes.length >= 24 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : undefined
    case 'image/gif':
      return bytes.length >= 10 ? { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) } : undefined
    case 'image/webp':
      return webpSize(bytes)
    case 'image/jpeg':
      return jpegSize(bytes)
    default:
      return undefined
  }
}

function webpSize(bytes: Buffer): { width: number; height: number } | undefined {
  const chunk = bytes.toString('latin1', 12, 16)
  if (chunk === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X' && bytes.length >= 30) return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
  return undefined
}

/** Walks the JPEG segments to the first start-of-frame marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1]!
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }
  return undefined
}

const SQUARE_THUMBS = [64, 80, 160] as const
const SIZED_THUMBS = [360, 480, 720, 800, 960, 1024] as const

/**
 * Slack's thumbnails of an image: 64, 80 and 160 as squares, 360 always, and
 * each larger size only when the original's long side is above the size
 * before it. Each fits its square box and is never larger than the original.
 */
function thumbs(url: string, width: number, height: number): Partial<File> {
  const out: Record<string, string | number> = {}
  for (const size of SQUARE_THUMBS) out[`thumb_${size}`] = `${url}?thumb=${size}`
  const long = Math.max(width, height)
  SIZED_THUMBS.forEach((size, index) => {
    const previous = SIZED_THUMBS[index - 1]
    if (previous !== undefined && long <= previous) return
    const scale = Math.min(1, size / long)
    out[`thumb_${size}`] = `${url}?thumb=${size}`
    out[`thumb_${size}_w`] = Math.round(width * scale)
    out[`thumb_${size}_h`] = Math.round(height * scale)
  })
  return out as Partial<File>
}

/** The file object Slack puts on a message and in upload answers. */
export function fileObject(baseUrl: string, stored: StoredFile, isPublic = false): File {
  const url = `${baseUrl}/files/${stored.id}/${encodeURIComponent(stored.name)}`
  const type = typeOf(stored.name, stored.mimetype)
  const size = stored.bytes === undefined ? undefined : imageSize(stored.bytes)
  const seconds = Math.floor(stored.created / 1000)
  return {
    id: stored.id,
    created: seconds,
    timestamp: seconds,
    name: stored.name,
    title: stored.title ?? stored.name,
    mimetype: stored.mimetype,
    filetype: type.filetype,
    pretty_type: type.pretty,
    user: stored.user,
    size: stored.bytes?.length ?? stored.length,
    mode: 'hosted',
    is_external: false,
    is_public: isPublic,
    url_private: url,
    url_private_download: `${url}?download=1`,
    permalink: url,
    ...(size === undefined ? {} : { original_w: size.width, original_h: size.height, ...thumbs(url, size.width, size.height) }),
  }
}
