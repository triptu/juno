import { describe, expect, it } from 'vitest'
import { csvRows, fileMediaKind, fileTextKind } from '../src/index'

describe('file kinds', () => {
  it.each([
    [{ mimetype: 'image/png', name: 'a.png' }, 'image'],
    [{ mimetype: 'video/quicktime', name: 'demo.mov' }, 'video'],
    [{ mimetype: 'audio/mpeg', name: 'standup.mp3' }, 'audio'],
    [{ mimetype: 'audio/mp4', subtype: 'slack_audio', name: 'audio_message.m4a' }, 'audio'],
    [{ mimetype: 'application/pdf', name: 'plan.pdf' }, 'pdf'],
    [{ mimetype: 'text/html', name: 'mail.html' }, 'html'],
    [{ mimetype: 'text/plain', filetype: 'html', mode: 'snippet', name: 'page.html' }, 'text'],
    [{ mimetype: 'text/plain', filetype: 'markdown', mode: 'snippet', name: 'notes' }, 'text'],
    [{ mimetype: 'text/csv', name: 'export.csv' }, 'text'],
    [{ mimetype: 'application/json', name: 'config.json' }, 'text'],
    [{ mimetype: 'application/octet-stream', name: 'deploy.log' }, 'text'],
    [{ mimetype: 'text/calendar', name: 'invite.ics' }, 'file'],
    [{ mimetype: 'application/zip', name: 'logs.zip' }, 'file'],
    [{ mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filetype: 'docx', name: 'brief.docx' }, 'file'],
    [{ mode: 'tombstone' }, 'deleted'],
  ] as const)('%o is %s', (file, kind) => {
    expect(fileMediaKind(file)).toBe(kind)
  })

  it('reads how to draw text from the type, the filetype and the name', () => {
    expect(fileTextKind({ mimetype: 'text/markdown', name: 'README.md' })).toEqual({ kind: 'markdown' })
    expect(fileTextKind({ mimetype: 'text/plain', filetype: 'markdown', name: 'notes' })).toEqual({ kind: 'markdown' })
    expect(fileTextKind({ mimetype: 'text/tab-separated-values', name: 'rows.tsv' })).toEqual({ kind: 'csv' })
    expect(fileTextKind({ mimetype: 'application/json', name: 'a.json' })).toEqual({ kind: 'json' })
    expect(fileTextKind({ mimetype: 'text/plain', filetype: 'python', pretty_type: 'Python', name: 'fix.py' })).toEqual({ kind: 'code', language: 'Python' })
    expect(fileTextKind({ mimetype: 'text/plain', filetype: 'shell', name: 'run' })).toEqual({ kind: 'code', language: 'Shell' })
    expect(fileTextKind({ mimetype: 'text/plain', filetype: 'text', name: 'migrate.ts' })).toEqual({ kind: 'code', language: 'TypeScript' })
    expect(fileTextKind({ mimetype: 'text/plain', filetype: 'text', name: 'deploy.log' })).toEqual({ kind: 'plain' })
  })
})

describe('csv rows', () => {
  it('splits fields, keeps quoted commas, quotes and line breaks, and stops at the row cap', () => {
    const text = 'name,note\r\n"Maya, K","said ""yes"""\nLeo,"two\nlines"\nAna,ok\n'
    expect(csvRows(text, 10)).toEqual({ rows: [['name', 'note'], ['Maya, K', 'said "yes"'], ['Leo', 'two\nlines'], ['Ana', 'ok']], more: false })
    expect(csvRows(text, 2)).toEqual({ rows: [['name', 'note'], ['Maya, K', 'said "yes"']], more: true })
  })

  it('reads a tab-separated file by its first line', () => {
    expect(csvRows('a\tb\n1,5\t2', 10).rows).toEqual([['a', 'b'], ['1,5', '2']])
  })
})
