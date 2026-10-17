/**
 * Files the owner gives Juno (SPEC 12 "Writing", 13.1). Images go to the
 * chat model as image input when the model reads images; text files go
 * into the message as text, cut at a size limit; any other file stays in
 * the composer for a person or channel. Pure rules and the wire shapes;
 * the renderer does the decoding and scaling, the agent checks again.
 */
import { Schema } from 'effect'

/** Image types every chat provider Juno uses takes inline. */
export const JUNO_IMAGE_TYPES: ReadonlyArray<string> = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * Images per message, and how large one may be once scaled: the long edge,
 * the pixel count and the encoded bytes. 1568px and about 1.2 megapixels
 * is the most Anthropic models use without scaling again; a larger image
 * only costs more.
 */
export const JUNO_IMAGE_LIMITS = { count: 4, edge: 1568, pixels: 1_200_000, bytes: 1_000_000 } as const

/** The thumbnail the chat shows: its long edge, at twice the bubble's 160px. */
export const JUNO_THUMB_EDGE = 320
/** A thumbnail's data URL is at most this long. */
export const JUNO_THUMB_CHARS = 96_000

/** A file larger than this is not read for Juno at all: decoding it would take too much memory. */
export const JUNO_SOURCE_MAX_BYTES = 40_000_000

/** Text files per message, the bytes kept of each, and of all of them together. */
export const JUNO_TEXT_LIMITS = { count: 4, bytes: 16_384, total: 32_768 } as const

/** Text by type, or by extension when the type is empty or generic, as Finder gives for source files. */
const TEXT_TYPES = /^(?:text\/.+|application\/(?:json|xml|x-yaml|yaml|toml|x-sh|javascript|typescript|sql|csv|x-ndjson))$/
const TEXT_EXTENSIONS = /\.(?:txt|md|markdown|csv|tsv|json|jsonl|ndjson|ya?ml|toml|xml|html?|css|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|m|sh|zsh|bash|sql|log|ini|conf|env\.example|diff|patch|qnt)$/i

export type JunoFileKind = 'image' | 'text' | 'other'

/** What Juno does with a file: an image to look at, text to read, or nothing (a PDF, a video, an archive). */
export function junoFileKind(mimetype: string, name: string): JunoFileKind {
  if (JUNO_IMAGE_TYPES.includes(mimetype)) return 'image'
  if (TEXT_TYPES.test(mimetype)) return 'text'
  if ((mimetype === '' || mimetype === 'application/octet-stream') && TEXT_EXTENSIONS.test(name)) return 'text'
  return 'other'
}

/** The size to scale an image to: within the long edge and the pixel count, never larger than it is. */
export function fitImage(
  width: number,
  height: number,
  limits: { readonly edge: number; readonly pixels: number } = JUNO_IMAGE_LIMITS,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, limits.edge / Math.max(width, height), Math.sqrt(limits.pixels / (width * height)))
  if (scale >= 1) return { width, height }
  // The small epsilon keeps a side scaled to exactly the edge from rounding down a pixel.
  return { width: Math.max(1, Math.floor(width * scale + 1e-9)), height: Math.max(1, Math.floor(height * scale + 1e-9)) }
}

/**
 * The most input tokens an image of this size can cost on any provider
 * Juno uses: Anthropic's width × height / 750, OpenAI's 512px tiles (85 +
 * 170 per tile, after fitting 2048 and then 768 on the short side) and its
 * 32px patches (at most 1536, times up to 2.5). Gemini's 258 per 768px
 * tile is below all three.
 */
export function imageTokenBound(width: number, height: number): number {
  const anthropic = Math.ceil((width * height) / 750)
  const fit = Math.min(1, 2048 / Math.max(width, height))
  const short = Math.min(1, 768 / (Math.min(width, height) * fit))
  const tiles = Math.ceil((width * fit * short) / 512) * Math.ceil((height * fit * short) / 512)
  const patches = Math.min(1536, Math.ceil(width / 32) * Math.ceil(height / 32)) * 2.5
  return Math.ceil(Math.max(anthropic, 85 + 170 * tiles, patches))
}

/**
 * The pixel size of a PNG, JPEG, GIF or WebP from its first bytes.
 * Undefined for anything else, or a header too short to say.
 */
export function imageSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const at = (offset: number, text: string) => [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0))
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : undefined)
  if (bytes.length >= 24 && bytes[0] === 0x89 && at(1, 'PNG') && at(12, 'IHDR')) return size(view.getUint32(16), view.getUint32(20))
  if (bytes.length >= 10 && at(0, 'GIF8')) return size(view.getUint16(6, true), view.getUint16(8, true))
  if (bytes.length >= 30 && at(0, 'RIFF') && at(8, 'WEBP')) {
    if (at(12, 'VP8 ')) return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    if (at(12, 'VP8L')) {
      const bits = view.getUint32(21, true)
      return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (at(12, 'VP8X')) return size(1 + (view.getUint32(24, true) & 0xffffff), 1 + (view.getUint32(27, true) & 0xffffff))
    return undefined
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: walk the segments to the first start-of-frame marker.
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return undefined
      const marker = bytes[offset + 1]!
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return size(view.getUint16(offset + 7), view.getUint16(offset + 5))
      }
      offset += 2 + view.getUint16(offset + 2)
    }
  }
  return undefined
}

/** The first `bytes` UTF-8 bytes of `text`, at a code point boundary, and whether anything was cut. */
export function cutText(text: string, bytes: number): { readonly text: string; readonly cut: boolean } {
  let used = 0
  let end = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (used + size > bytes) return { text: text.slice(0, end), cut: true }
    used += size
    end += char.length
  }
  return { text, cut: false }
}

/** Why a file stays in the composer when the rest go to Juno. */
export type JunoLeft = 'images' | 'other' | 'more'

/** The line under files a send to Juno leaves, for each reason; `otherHere` where no person or channel can be chosen. `chatCopy.composer.filesLeft`. */
export const filesLeftCopy = {
  images: "This model can't read images. Choose another in Settings › Juno.",
  other: 'Juno reads images and text files. Pick a person or channel to send the others.',
  otherHere: 'Juno reads images and text files only.',
  more: `Juno takes up to ${JUNO_IMAGE_LIMITS.count} images and ${JUNO_TEXT_LIMITS.count} text files at a time.`,
} as const

/**
 * What the composer can give Juno now: the images, if the model reads
 * them, and the text files, within their counts; the rest stays. `left`
 * says why something stays: `images` when the model cannot read them,
 * `other` for files Juno does not read at all (or too large to read),
 * `more` past the counts.
 */
export function junoTakes<F extends { readonly mimetype: string; readonly name: string; readonly size: number }>(
  files: ReadonlyArray<F>,
  readsImages: boolean,
): { readonly taken: ReadonlyArray<F>; readonly kept: ReadonlyArray<F>; readonly left: ReadonlySet<JunoLeft> } {
  const taken: F[] = []
  const kept: F[] = []
  const left = new Set<JunoLeft>()
  let images = 0
  let texts = 0
  for (const file of files) {
    const kind = file.size > JUNO_SOURCE_MAX_BYTES ? 'other' : junoFileKind(file.mimetype, file.name)
    const room = kind === 'image' ? images < JUNO_IMAGE_LIMITS.count : texts < JUNO_TEXT_LIMITS.count
    if (kind === 'image' && !readsImages) left.add('images')
    else if (kind === 'other') left.add('other')
    else if (!room) left.add('more')
    else {
      if (kind === 'image') images++
      else texts++
      taken.push(file)
      continue
    }
    kept.push(file)
  }
  return { taken, kept, left }
}

const Name = Schema.String.check(Schema.isMaxLength(255))

/** An image as the composer sends it: scaled, encoded, base64, with its thumbnail as a data URL. */
export const JunoImageInput = Schema.TaggedStruct('image', {
  name: Name,
  mimeType: Schema.Literals(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: Schema.String.check(Schema.isMaxLength(Math.ceil(JUNO_IMAGE_LIMITS.bytes / 3) * 4)),
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: JUNO_IMAGE_LIMITS.edge })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: JUNO_IMAGE_LIMITS.edge })),
  thumb: Schema.String.check(Schema.isMaxLength(JUNO_THUMB_CHARS)),
})
/** A text file as the composer sends it: its text, already cut to `JUNO_TEXT_LIMITS.bytes`. */
export const JunoTextInput = Schema.TaggedStruct('text', {
  name: Name,
  text: Schema.String.check(Schema.isMaxLength(JUNO_TEXT_LIMITS.bytes)),
  cut: Schema.Boolean,
})
export const JunoFileInput = Schema.Union([JunoImageInput, JunoTextInput])
export type JunoFileInput = typeof JunoFileInput.Type

/** A file on the owner's bubble: an image's box and name (its thumbnail is fetched by `n`), or a text file's name. */
export const OwnerFile = Schema.Union([
  Schema.TaggedStruct('image', { n: Schema.Int, name: Schema.String, width: Schema.Int, height: Schema.Int }),
  Schema.TaggedStruct('text', { n: Schema.Int, name: Schema.String }),
])
export type OwnerFile = typeof OwnerFile.Type

/** The bubble's file list for what a send carried. */
export const ownerFilesOf = (files: ReadonlyArray<JunoFileInput>): ReadonlyArray<OwnerFile> =>
  files.map((file, n) => (file._tag === 'image' ? { _tag: 'image', n, name: file.name, width: file.width, height: file.height } : { _tag: 'text', n, name: file.name }))

/** The box an image thumbnail takes in the chat: its shape within 160px. */
export function thumbBox(width: number, height: number, edge = 160): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, edge / Math.max(width, height))
  return { width: Math.max(24, Math.round(width * scale)), height: Math.max(24, Math.round(height * scale)) }
}
