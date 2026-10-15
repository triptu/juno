/**
 * The pixel size of a PNG, JPEG, GIF or WebP from its first bytes, so a
 * staged image gets its box before anything decodes it (performance 3.3).
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

/** The mimetype of an image by its first bytes, for a file whose name says nothing. */
export function imageType(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}
