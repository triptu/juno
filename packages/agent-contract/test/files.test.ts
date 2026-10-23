import { describe, expect, it } from 'bun:test'
import { cutText, fitImage, imageSize, imageTokenBound, JUNO_IMAGE_LIMITS, junoFileKind, junoTakes, thumbBox } from '../src/index'

const file = (name: string, mimetype: string, size = 1_000) => ({ name, mimetype, size })

describe('junoFileKind', () => {
  it('reads PNG, JPEG, WebP and GIF as images, and text by type or by extension', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) expect(junoFileKind(type, 'x')).toBe('image')
    expect(junoFileKind('text/plain', 'notes')).toBe('text')
    expect(junoFileKind('application/json', 'data')).toBe('text')
    expect(junoFileKind('', 'build.log')).toBe('text')
    expect(junoFileKind('application/octet-stream', 'main.rs')).toBe('text')
  })

  it('reads nothing else: PDFs, HEIC photos, SVG, archives', () => {
    for (const [type, name] of [['application/pdf', 'brief.pdf'], ['image/heic', 'IMG_1.heic'], ['image/svg+xml', 'logo.svg'], ['application/zip', 'a.zip'], ['application/octet-stream', 'blob.bin']]) {
      expect(junoFileKind(type!, name!)).toBe('other')
    }
  })
})

describe('fitImage', () => {
  it('keeps an image that fits as it is, and never makes one larger', () => {
    expect(fitImage(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitImage(10, 10)).toEqual({ width: 10, height: 10 })
  })

  it('scales a photo to the pixel count, keeping its shape', () => {
    // 4032 × 3024, a phone photo: 12 megapixels down to about 1.2.
    const size = fitImage(4032, 3024)
    expect(size.width * size.height).toBeLessThanOrEqual(JUNO_IMAGE_LIMITS.pixels)
    expect(size.width / size.height).toBeCloseTo(4 / 3, 2)
  })

  it('scales a long screenshot to the long edge', () => {
    const size = fitImage(1200, 6000)
    expect(size.height).toBe(JUNO_IMAGE_LIMITS.edge)
    expect(size.width).toBe(Math.floor(1200 * (JUNO_IMAGE_LIMITS.edge / 6000)))
  })
})

describe('imageTokenBound', () => {
  it('is at least what Anthropic and OpenAI charge for the image', () => {
    // Anthropic: 1092 × 1092 is about 1590 tokens. OpenAI high detail: 1024 × 1024 is 4 tiles, 765 tokens.
    expect(imageTokenBound(1092, 1092)).toBeGreaterThanOrEqual(1590)
    expect(imageTokenBound(1024, 1024)).toBeGreaterThanOrEqual(765)
    expect(imageTokenBound(1, 1)).toBeGreaterThanOrEqual(85)
  })

  it('grows with the image and stays bounded at the limits', () => {
    expect(imageTokenBound(200, 200)).toBeLessThan(imageTokenBound(1000, 1000))
    expect(imageTokenBound(1568, 765)).toBeLessThanOrEqual(4000)
  })
})

describe('imageSize', () => {
  it('reads a PNG header', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(png.buffer).setUint32(16, 640)
    new DataView(png.buffer).setUint32(20, 400)
    expect(imageSize(png)).toEqual({ width: 640, height: 400 })
  })

  it('says nothing for bytes that are not an image', () => {
    expect(imageSize(new TextEncoder().encode('not an image at all, just words'))).toBeUndefined()
  })
})

describe('cutText', () => {
  it('keeps short text whole', () => {
    expect(cutText('hello', 10)).toEqual({ text: 'hello', cut: false })
  })

  it('cuts at a character boundary, never inside one', () => {
    // "é" is two bytes: four bytes fit "aé" and half of the next.
    expect(cutText('aééé', 4)).toEqual({ text: 'aé', cut: true })
    expect(cutText('👍👍', 5)).toEqual({ text: '👍', cut: true })
  })
})

describe('junoTakes', () => {
  it('takes images and text files and leaves the rest, saying why', () => {
    const result = junoTakes([file('chart.png', 'image/png'), file('brief.pdf', 'application/pdf'), file('notes.md', 'text/markdown')], true)
    expect(result.taken.map((f) => f.name)).toEqual(['chart.png', 'notes.md'])
    expect(result.kept.map((f) => f.name)).toEqual(['brief.pdf'])
    expect([...result.left]).toEqual(['other'])
  })

  it('leaves images when the model cannot read them', () => {
    const result = junoTakes([file('chart.png', 'image/png'), file('notes.md', 'text/markdown')], false)
    expect(result.taken.map((f) => f.name)).toEqual(['notes.md'])
    expect([...result.left]).toEqual(['images'])
  })

  it('takes at most four images, and nothing too large to read', () => {
    const images = Array.from({ length: 6 }, (_, i) => file(`shot-${i}.png`, 'image/png'))
    const result = junoTakes([...images, file('huge.png', 'image/png', 50_000_000)], true)
    expect(result.taken).toHaveLength(JUNO_IMAGE_LIMITS.count)
    expect(new Set(result.left)).toEqual(new Set(['more', 'other']))
  })
})

describe('thumbBox', () => {
  it('keeps the shape within 160px, and never thinner than 24px', () => {
    expect(thumbBox(1600, 800)).toEqual({ width: 160, height: 80 })
    expect(thumbBox(100, 50)).toEqual({ width: 100, height: 50 })
    expect(thumbBox(4000, 100)).toEqual({ width: 160, height: 24 })
  })
})
