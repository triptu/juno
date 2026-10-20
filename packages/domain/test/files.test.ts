import { describe, expect, it } from 'vitest'
import { fileMediaKind, knownMimetype } from '../src/index'

describe('file kind', () => {
  it('reads the kind from the mimetype when Slack has one', () => {
    expect(fileMediaKind({ mimetype: 'image/png', name: 'notes.txt' })).toBe('image')
    expect(fileMediaKind({ mimetype: 'video/quicktime' })).toBe('video')
    expect(fileMediaKind({ mimetype: 'audio/mpeg' })).toBe('audio')
    expect(fileMediaKind({ mimetype: 'application/pdf' })).toBe('pdf')
    expect(fileMediaKind({ mimetype: 'application/zip', name: 'photo.png' })).toBe('file')
  })

  it('falls back to the short filetype, then the name, while Slack has not worked the type out', () => {
    expect(fileMediaKind({ mimetype: '', filetype: 'png' })).toBe('image')
    expect(fileMediaKind({ mimetype: '', filetype: '', name: 'Screenshot 2026-10-20 at 13.14.12.png' })).toBe('image')
    expect(fileMediaKind({ name: 'clip.MOV' })).toBe('video')
    expect(fileMediaKind({ mimetype: 'application/octet-stream', title: 'report.pdf' })).toBe('pdf')
    expect(fileMediaKind({ mimetype: '', filetype: '', name: 'archive' })).toBe('file')
    expect(fileMediaKind({})).toBe('file')
  })

  it('knows a mimetype only when it is set', () => {
    expect(knownMimetype({ mimetype: 'image/png' })).toBe('image/png')
    expect(knownMimetype({ mimetype: ' ' })).toBeUndefined()
    expect(knownMimetype({ mimetype: 'application/octet-stream' })).toBe('application/octet-stream')
    expect(knownMimetype({})).toBeUndefined()
  })
})
