import { describe, expect, it } from 'bun:test'
import { makeDevLog } from '../src/devLog'
import { capLines, clean, cleanLine, ENTRY_CHARS, MAX_LINES, summarise, VALUE_CHARS } from '../src/devLogText'

// Invented values in the shapes Slack uses; none is a real credential. Joined here so the
// file itself never holds a token-shaped string (the remote runner refuses those).
const token = ['xoxc', '1234567890', '1234567890123', '1234567890123', 'abcdef0123456789'.repeat(4)].join('-')
const cookie = 'xoxd-AbCdEf%2BgHiJkL%2FmNoP%3D%3D'

describe('developer log text', () => {
  it('removes Slack tokens, cookies and bearer credentials wherever they sit', () => {
    const text = `token=${token}&d=${cookie}; d-s=1700000000 Authorization: Bearer abc.def sk-or-v1-0123456789abcdef`
    const out = clean(text, 10_000)
    expect(out).not.toMatch(/xox[a-z]-/)
    expect(out).not.toContain('AbCdEf')
    expect(out).not.toContain('1700000000')
    expect(out).not.toContain('abc.def')
    expect(out).not.toContain('0123456789abcdef')
    expect(out).toContain('[removed]')
  })

  it('removes the value of a field whose name says it is a secret', () => {
    expect(cleanLine('token', 'anything').value).toBe('[removed]')
    expect(cleanLine('d', 'anything').value).toBe('[removed]')
    expect(cleanLine('Cookie', 'a=b').value).toBe('[removed]')
    expect(cleanLine('channel', 'C0123').value).toBe('C0123')
  })

  it('cuts long values with an ellipsis', () => {
    const out = clean('a'.repeat(VALUE_CHARS * 3))
    expect(out).toHaveLength(VALUE_CHARS)
    expect(out.endsWith('…')).toBe(true)
    expect(clean('short')).toBe('short')
  })

  it('caps an entry by line count and by total size, and counts what it left out', () => {
    const many = Array.from({ length: MAX_LINES + 10 }, (_, i) => ({ label: `f${i}`, value: 'v' }))
    const kept = capLines(many)
    expect(kept).toHaveLength(MAX_LINES + 1)
    expect(kept.at(-1)).toEqual({ label: '…', value: '10 more' })

    const wide = Array.from({ length: 30 }, (_, i) => ({ label: `f${i}`, value: 'x'.repeat(VALUE_CHARS) }))
    const fit = capLines(wide)
    const size = fit.slice(0, -1).reduce((sum, line) => sum + line.label.length + line.value.length, 0)
    expect(size).toBeLessThanOrEqual(ENTRY_CHARS)
    expect(fit.at(-1)?.label).toBe('…')
  })

  it('summarises a response by its top level, paging fields first', () => {
    const lines = summarise({
      ok: true,
      messages: [{ text: 'hello' }, { text: 'there' }],
      response_metadata: { next_cursor: 'bmV4dF90czoxNjAw' },
      has_more: true,
      channel: { id: 'C1', name: 'general' },
      warning: `leaked ${token}`,
    })
    expect(lines.slice(0, 2)).toEqual([
      { label: 'has_more', value: 'true' },
      { label: 'next_cursor', value: 'bmV4dF90czoxNjAw' },
    ])
    expect(lines).toContainEqual({ label: 'messages', value: '2 items' })
    expect(lines).toContainEqual({ label: 'channel', value: '{ id, name }' })
    expect(lines.find((line) => line.label === 'warning')?.value).not.toMatch(/xox[a-z]-/)
    // Nested values are not read: message text stays out of the summary.
    expect(JSON.stringify(lines)).not.toContain('hello')
  })
})

describe('developer log buffer', () => {
  it('keeps the newest entries, newest first, and never keeps a token from params', () => {
    const log = makeDevLog(3)
    for (let i = 0; i < 5; i++) {
      const end = log.slack.started({ method: `m${i}`, lane: 'interactive', reason: undefined, params: [['channel', 'C1'], ['note', `x ${token}`]], startedAt: i })
      end({ outcome: { _tag: 'ok' }, durationMs: 1, waitMs: 0, attempts: 1, retryAfterMillis: 0, size: 2, response: { ok: true } })
    }
    const all = { kinds: [], errorsOnly: false, text: '' }
    const { rows, total } = log.rows(all, 10)
    expect(total).toBe(3)
    expect(rows.map((row) => row.name)).toEqual(['m4', 'm3', 'm2'])
    expect(log.detail('1')).toBeNull()
    const detail = log.detail('4')
    expect(JSON.stringify(detail)).not.toMatch(/xox[a-z]-/)
    expect(detail?.sections.map((part) => part.title)).toEqual(['Request', 'Timing', 'Response'])
  })

  it('filters by kind, errors and text', () => {
    const log = makeDevLog()
    log.slack.started({ method: 'conversations.history', lane: 'background', reason: undefined, params: [], startedAt: 0 })({
      outcome: { _tag: 'rejected', error: 'channel_not_found' }, durationMs: 3, waitMs: 0, attempts: 1, retryAfterMillis: 0, size: 0, response: undefined,
    })
    log.socket({ _tag: 'Connected', fast: false })
    log.step({ name: 'sweep', event: 'started' })
    log.step({ name: 'sweep', event: 'finished', durationMs: 12 })
    const names = (filter: Partial<Parameters<typeof log.rows>[0]>) => log.rows({ kinds: [], errorsOnly: false, text: '', ...filter }, 10).rows.map((row) => row.name)
    expect(names({ kinds: ['sync'] })).toEqual(['sweep'])
    expect(names({ errorsOnly: true })).toEqual(['conversations.history'])
    expect(names({ text: 'NOT_FOUND' })).toEqual(['conversations.history'])
    expect(log.rows({ kinds: ['sync'], errorsOnly: false, text: '' }, 10).rows[0]).toMatchObject({ outcome: 'ok', durationMs: 12 })
  })
})
