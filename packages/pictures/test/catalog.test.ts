// Invariants every catalog entry keeps (SPEC 12, "Pictures and the gallery").
// No entry is pinned: the list changes as pictures are added and dropped.
import { describe, expect, it } from 'vitest'
import { PICTURE_ID, PICTURE_KINDS, yearOf } from '../src/index'
import { PICTURES } from '../src/catalog'

const CAPTION_MAX = 160
const LINE_MAX = 140

describe('the picture catalog', () => {
  it('has unique, file-safe ids', () => {
    const ids = PICTURES.map((picture) => picture.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(PICTURE_ID)
  })

  it('gives every picture a licence, a credit, a source page, its shape and a year', () => {
    for (const picture of PICTURES) {
      expect(['public-domain', 'cc0', 'cc-by-4.0'], picture.id).toContain(picture.licence)
      expect(picture.credit.trim(), picture.id).not.toBe('')
      expect(picture.sourceUrl, picture.id).toMatch(/^https:\/\//)
      expect(picture.ratio, picture.id).toBeGreaterThan(0.2)
      expect(picture.ratio, picture.id).toBeLessThan(5)
      expect(PICTURE_KINDS, picture.id).toContain(picture.kind)
      for (const field of [picture.title, picture.artist, picture.date, picture.medium, picture.place]) expect(field.trim(), picture.id).not.toBe('')
      expect(yearOf(picture.date), `${picture.id}: ${picture.date}`).toBeTypeOf('number')
      expect(picture.caption.length, picture.id).toBeGreaterThan(0)
      expect(picture.caption.length, picture.id).toBeLessThanOrEqual(CAPTION_MAX)
    }
  })

  it('gives every picture a short, sourced line, an about and one page to learn more', () => {
    for (const picture of PICTURES) {
      expect(picture.line.text.trim(), picture.id).not.toBe('')
      expect(picture.line.text.length, `${picture.id}: ${picture.line.text}`).toBeLessThanOrEqual(LINE_MAX)
      expect(picture.line.source.trim(), picture.id).not.toBe('')
      if (picture.line.by !== undefined) expect(picture.line.by.trim(), picture.id).not.toBe('')
      if (picture.line.url !== undefined) expect(picture.line.url, picture.id).toMatch(/^https?:\/\//)
      expect(picture.about.trim(), picture.id).not.toBe('')
      expect(picture.learnMore.label.trim(), picture.id).not.toBe('')
      expect(picture.learnMore.label, picture.id).not.toMatch(/^https?:|\.(com|org|gov|net)\b/)
      expect(picture.learnMore.url, picture.id).toMatch(/^https:\/\//)
    }
  })

  it('gives scale only in positive numbers, and distances only to space images', () => {
    for (const picture of PICTURES) {
      const scale = picture.scale
      if (scale === undefined) continue
      if (scale.kind === 'size') {
        expect(scale.widthCm, picture.id).toBeGreaterThan(0)
        expect(scale.heightCm, picture.id).toBeGreaterThan(0)
      } else {
        expect(picture.kind, picture.id).toBe('space')
        expect('lightYears' in scale ? scale.lightYears : scale.km, picture.id).toBeGreaterThan(0)
      }
    }
  })

  it('gives a space image its distance and no artwork one', () => {
    for (const picture of PICTURES) {
      if (picture.distance !== undefined) expect(picture.kind, picture.id).toBe('space')
    }
  })
})
