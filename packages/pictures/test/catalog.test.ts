// Invariants every catalog entry keeps (SPEC 12, "Pictures and the gallery").
// No entry is pinned: the list changes as pictures are added and dropped.
import { describe, expect, it } from 'vitest'
import { PICTURE_ID, PICTURE_KINDS } from '../src/index'
import { PICTURES } from '../src/catalog'

const CAPTION_MAX = 160
const FACT_MAX = 320

describe('the picture catalog', () => {
  it('has unique, file-safe ids', () => {
    const ids = PICTURES.map((picture) => picture.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(PICTURE_ID)
  })

  it('gives every picture a licence, a credit, a source page and its shape', () => {
    for (const picture of PICTURES) {
      expect(['public-domain', 'cc0', 'cc-by-4.0'], picture.id).toContain(picture.licence)
      expect(picture.credit.trim(), picture.id).not.toBe('')
      expect(picture.sourceUrl, picture.id).toMatch(/^https:\/\//)
      expect(picture.ratio, picture.id).toBeGreaterThan(0.2)
      expect(picture.ratio, picture.id).toBeLessThan(5)
      expect(PICTURE_KINDS, picture.id).toContain(picture.kind)
      for (const field of [picture.title, picture.artist, picture.date, picture.medium, picture.place]) expect(field.trim(), picture.id).not.toBe('')
    }
  })

  it('tells each story in a short caption and three to five sourced facts', () => {
    for (const picture of PICTURES) {
      expect(picture.caption.length, picture.id).toBeGreaterThan(0)
      expect(picture.caption.length, picture.id).toBeLessThanOrEqual(CAPTION_MAX)
      expect(picture.facts.length, picture.id).toBeGreaterThanOrEqual(3)
      expect(picture.facts.length, picture.id).toBeLessThanOrEqual(5)
      for (const fact of picture.facts) {
        expect(fact.text.length, picture.id).toBeLessThanOrEqual(FACT_MAX)
        expect(fact.source.trim(), `${picture.id}: ${fact.text}`).not.toBe('')
        if (fact.url !== undefined) expect(fact.url, picture.id).toMatch(/^https?:\/\//)
      }
    }
  })

  it('gives a space image its distance and no artwork one', () => {
    for (const picture of PICTURES) {
      if (picture.distance !== undefined) expect(picture.kind, picture.id).toBe('space')
    }
  })
})
