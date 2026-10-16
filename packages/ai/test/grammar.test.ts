import { describe, expect, it } from 'vitest'
import { grammarCheck, validateOutput } from '../src/index'

const edit = (from: string, to: string, start = 0, kind = 'confusion') => ({ from, to, start, kind })
const check = (draft: string, edits: unknown[]) => validateOutput(grammarCheck, { draft }, { edits })

describe('grammar validation', () => {
  it('accepts only the flagged words and keeps the surrounding lowercase text', () => {
    expect(check('i think its broken', [edit('its', "it's", 8)])).toEqual({ ok: true, value: { edits: [edit('its', "it's", 8)] } })
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
