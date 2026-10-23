import { describe, expect, it } from 'bun:test'
import { grammarCheck, validateOutput } from '../src/index'

const edit = (from: string, to: string, start = 0, kind = 'confusion') => ({ from, to, start, kind })
const check = (draft: string, edits: unknown[]) => validateOutput(grammarCheck, { draft }, { edits })

describe('grammar validation', () => {
  it('accepts only the flagged words and keeps the surrounding lowercase text', () => {
    expect(check('i think its broken', [edit('its', "it's", 8)])).toEqual({ ok: true, value: { edits: [edit('its', "it's", 8)] } })
  })
  it('skips above 1000 Unicode characters and masks protected input without moving offsets', () => {
    const long = 'its broken ' + 'a'.repeat(990)
    expect(check(long, [edit('its', "it's")])).toEqual({ ok: true, value: { edits: [] } })
    const boundary = 'its broken ' + 'a'.repeat(989)
    expect(check(boundary, [edit('its', "it's")])).toEqual({ ok: true, value: { edits: [edit('its', "it's")] } })
    const draft = '> its broken\n`their is` https://example.com <@U123> its broken'
    const masked = grammarCheck.render({ draft })
    expect(masked.length).toBe(draft.length)
    expect(masked).not.toContain('their')
    expect(masked).not.toContain('https')
    expect(masked).not.toContain('U123')
    expect(masked.indexOf('its broken')).toBe(draft.lastIndexOf('its broken'))
  })
  it('accepts plain spelling fixes without rewriting the sentence', () => {
    const edits = [edit('grammer', 'grammar', 5, 'spelling'), edit('chek', 'check', 13, 'spelling')]
    expect(check('does grammer chek properly happen?', edits)).toEqual({ ok: true, value: { edits } })
    for (const [from, to] of [['chek', 'Check'], ['chek', 'check!'], ['chek', 'please check'], ['grammer', 'syntax']]) {
      expect(check(from!, [edit(from!, to!, 0, 'spelling')])).toEqual({ ok: true, value: { edits: [] } })
    }
    expect(check('`chek`', [edit('chek', 'check', 1, 'spelling')])).toEqual({ ok: true, value: { edits: [] } })
  })
  it('rejects malformed output', () => {
    expect(check('its broken', [{ from: 'its', to: "it's" }]).ok).toBe(false)
    expect(check('its broken', [edit('its', "it's", -1)]).ok).toBe(false)
    expect(check('its broken', [edit('its', "it's", 0, 'rewrite')]).ok).toBe(false)
  })
  it('drops rewrites, case, punctuation, partial words, mismatched offsets and overlaps', () => {
    for (const bad of [edit('its broken', 'it is currently broken'), edit('its', "It's"), edit('its', 'its!'), edit('it', "it's"), edit('its', "it's", 1)]) {
      expect(check('its broken', [bad])).toEqual({ ok: true, value: { edits: [] } })
    }
    expect(check('its broken', [edit('its', "it's"), edit('its', "it's")])).toEqual({ ok: true, value: { edits: [edit('its', "it's")] } })
    expect(check('i think so', [edit('i', 'I', 0, 'agreement')])).toEqual({ ok: true, value: { edits: [] } })
  })
  it('leaves protected text alone even when the model flags it', () => {
    for (const draft of ['`its broken`', '``its broken``', '`its broken', '```\nits broken\n```', '> its broken', 'https://test.invalid/its', '@its', '<@its>', ':its:', 'www.its.test', 'its@example.test']) {
      expect(check(draft, [edit('its', "it's", draft.indexOf('its'))])).toEqual({ ok: true, value: { edits: [] } })
    }
  })
  it('allows a single missing word, a doubled word, or verb agreement, not a wider replacement', () => {
    for (const [draft, finding] of [
      ['we need send it', edit('need', 'need to', 3, 'missing')],
      ['the the report', edit('the the', 'the', 0, 'doubled')],
      ['they is ready', edit('is', 'are', 5, 'agreement')],
      ['they goes home', edit('goes', 'go', 5, 'agreement')],
      ['she carry it', edit('carry', 'carries', 4, 'agreement')],
    ] as const) expect(check(draft, [finding])).toEqual({ ok: true, value: { edits: [finding] } })
    expect(check('we need send it', [edit('need', 'should probably', 3, 'missing')])).toEqual({ ok: true, value: { edits: [] } })
  })
})
