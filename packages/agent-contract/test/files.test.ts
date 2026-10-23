import { describe, expect, it } from 'bun:test'
import { cutText, fitImage, imageSize, JUNO_IMAGE_LIMITS, junoTakes } from '../src/index'

const file = (name: string, mimetype: string, size = 1_000) => ({ name, mimetype, size })

it('fitImage keeps an image that fits, and scales a photo to the pixel count and a long screenshot to the long edge', () => {
  expect(fitImage(800, 600)).toEqual({ width: 800, height: 600 })
  // 4032 × 3024, a phone photo: 12 megapixels down to about 1.2, keeping its shape.
  const photo = fitImage(4032, 3024)
  expect(photo.width * photo.height).toBeLessThanOrEqual(JUNO_IMAGE_LIMITS.pixels)
  expect(photo.width / photo.height).toBeCloseTo(4 / 3, 2)
  const screenshot = fitImage(1200, 6000)
  expect(screenshot.height).toBe(JUNO_IMAGE_LIMITS.edge)
  expect(screenshot.width).toBe(Math.floor(1200 * (JUNO_IMAGE_LIMITS.edge / 6000)))
})

it('imageSize reads a PNG header and says nothing for bytes that are not an image', () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(png.buffer).setUint32(16, 640)
  new DataView(png.buffer).setUint32(20, 400)
  expect(imageSize(png)).toEqual({ width: 640, height: 400 })
  expect(imageSize(new TextEncoder().encode('not an image at all, just words'))).toBeUndefined()
})

it('cutText keeps short text whole and cuts long text at a character boundary, never inside one', () => {
  expect(cutText('hello', 10)).toEqual({ text: 'hello', cut: false })
  // "é" is two bytes: four bytes fit "aé" and half of the next.
  expect(cutText('aééé', 4)).toEqual({ text: 'aé', cut: true })
  expect(cutText('👍👍', 5)).toEqual({ text: '👍', cut: true })
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
