import { describe, expect, it } from 'vitest'
import { filesToFetch, imagesWithoutThumbs, isReady, keepFuller } from '../src/files'

const fresh = { id: 'F1', name: 'shot.png', title: 'shot.png', mimetype: '', filetype: '', pretty_type: '', size: 43_000, mode: 'hosted', url_private: 'https://files.example/F1' }
const processed = { ...fresh, mimetype: 'image/png', filetype: 'png', pretty_type: 'PNG', original_w: 800, original_h: 600, thumb_360: 'https://files.example/F1/360', thumb_360_w: 360, thumb_360_h: 270 }
const json = (files: ReadonlyArray<object>) => JSON.stringify(files)

describe('files Slack has not finished processing', () => {
  it('is not ready while the type is empty, and is asked about', () => {
    expect(isReady(fresh)).toBe(false)
    expect(isReady(processed)).toBe(true)
    expect(filesToFetch(json([fresh]))).toEqual(['F1'])
    expect(filesToFetch(json([processed]))).toEqual([])
    expect(filesToFetch(json([{ ...fresh, name: 'notes.zip', mimetype: 'application/zip' }]))).toEqual([])
  })

  it('counts as an image from its name, so the sent copy stands in', () => {
    expect(imagesWithoutThumbs(json([fresh]))).toEqual(['F1'])
    expect(imagesWithoutThumbs(json([processed]))).toEqual([])
    expect(imagesWithoutThumbs(json([{ ...fresh, name: 'notes.zip' }]))).toEqual([])
  })

  it('never lets a processed copy be replaced by one without the type or thumbnails', () => {
    expect(keepFuller(json([processed]), json([fresh]))).toBe(json([processed]))
    expect(keepFuller(json([fresh]), json([processed]))).toBe(json([processed]))
    const laterWithoutThumbs = { ...processed, thumb_360: undefined, thumb_360_w: undefined, thumb_360_h: undefined }
    expect(JSON.parse(keepFuller(json([processed]), json([laterWithoutThumbs]))!)).toEqual([processed])
  })
})
