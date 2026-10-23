import { describe, expect, it } from 'bun:test'
import { audienceCheck, clarityCheck, sendChecksApply, type ClarityPrefs } from '../src/index'
import { eng, hiring, maya } from './fixtures'

const long = (words: number, prefix = '') => prefix + Array.from({ length: words }, (_, i) => `word${i}`).join(' ')

describe('clarity check', () => {
  // [typed, options, what Fix and send sends; undefined when the text is sent without a check]
  it.each<[string, ClarityPrefs | undefined, string | undefined]>([
    ['Friday works for me.', undefined, undefined],
    ['Can you take a look?', undefined, undefined],
    // Doubled words, whatever their case and across a line break; not where English doubles them.
    ['I think the the plan is fine.', undefined, 'I think the plan is fine.'],
    ['He had had enough.', undefined, undefined],
    ['The build is is green.', undefined, 'The build is green.'],
    ['Sure, what it is is a bug.', undefined, undefined],
    ['The the build is green.', undefined, 'The build is green.'],
    ['I think THE the build is green.', undefined, 'I think THE build is green.'],
    ['I think the\nthe build is green.', undefined, 'I think the\nbuild is green.'],
    ['> I think the\nthe build is green.', undefined, undefined],
    ['I think `the`\nthe build is green.', undefined, undefined],
    // Typos from the table keep their capital.
    ['Did you recieve it? Recieve again.', undefined, 'Did you receive it? Receive again.'],
    // A missing question mark; short exclamations and statements are left alone; never on a quote.
    ['Can we ship this on Friday', undefined, 'Can we ship this on Friday?'],
    ['Can we ship this on Friday.', undefined, 'Can we ship this on Friday?'],
    ['Can do', undefined, undefined],
    ['We ship on Friday', undefined, undefined],
    ['> are we done\nCan we ship this on Friday', undefined, '> are we done\nCan we ship this on Friday?'],
    // Quotes, code, URLs, emails, mentions and emoji are left alone; a fence ends.
    ['> teh original the the\n`teh` and https://example.com/teh teh@example.com @Teh Person :teh: stays', undefined, undefined],
    ['```\nteh code\n```\nteh prose', undefined, '```\nteh code\n```\nthe prose'],
    // A lone lowercase i only when asked to; lowercase style is never flagged by default.
    ["i think i'll do it, if i can.", { capitalI: true }, "I think I'll do it, if I can."],
    ['see i.e. the doc', { capitalI: true }, undefined],
    ["i think i'll ship it friday, im around after lunch", undefined, "i think i'll ship it friday, i'm around after lunch"],
    ['sounds good, i can take it', undefined, undefined],
    ['i think so', { capitalI: false }, undefined],
    ['i recieve it', { capitalI: false }, 'i receive it'],
    ['im ready', { capitalI: false }, "i'm ready"],
    // Each switch turns off its own kind.
    ['i recieve the the report', { typos: false, capitalI: true }, 'I recieve the the report'],
    ['can i recieve the report', { questionMarks: false }, 'can i receive the report'],
  ])('%j with %j', (typed, options, fixed) => {
    expect(clarityCheck(typed, options)?.fixed).toBe(fixed)
  })

  it('notes a sentence over 40 words without rewriting it, with less confidence than a fix', () => {
    const text = long(45) + '.'
    const r = clarityCheck(text)
    expect(r?.fixes).toEqual([])
    expect(r?.fixed).toBe(text)
    expect(r?.longSentence).toBe(true)
    expect(r?.confidence).toBeGreaterThan(0)
    expect(r?.confidence).toBeLessThan(clarityCheck('teh plan')!.confidence)
    expect(clarityCheck('teh plan')!.confidence).toBeLessThanOrEqual(1)
  })

  it('turns off the long sentence note on its own', () => {
    const text = long(41, 'i ')
    expect(clarityCheck(text, { capitalI: true, longSentences: false })?.longSentence).toBe(false)
    expect(clarityCheck(text, { capitalI: false })?.longSentence).toBe(true)
    expect(clarityCheck(text, { capitalI: false, longSentences: false })).toBeUndefined()
  })
})

describe('audience check', () => {
  it.each([
    ["Let's discuss the candidate's salary before the offer", eng, ['candidate', 'salary', 'offer']],
    ['new headcount for Q1', eng, ['headcount']],
    ['performance review tomorrow', eng, ['performance review']],
    // Whole words only.
    ['compose the offering', eng, undefined],
    ['the compiler is slow', eng, undefined],
    ['', eng, undefined],
    // Private channels and DMs are not checked.
    ['candidate salary', hiring, undefined],
    ['candidate salary', maya, undefined],
  ] as const)('%j in %#', (text, channel, matched) => {
    expect(audienceCheck(text, channel)?.matched).toEqual(matched)
  })
})

describe('which messages the checks on send read', () => {
  it('skips empty messages and those above 1000 Unicode characters', () => {
    expect(sendChecksApply('its broken')).toBe(true)
    expect(sendChecksApply('  \n ')).toBe(false)
    expect(sendChecksApply('its broken ' + 'a'.repeat(989))).toBe(true)
    expect(sendChecksApply('its broken ' + 'a'.repeat(990))).toBe(false)
    // Characters, not UTF-16 units: 1000 emoji are still read.
    expect(sendChecksApply('😄'.repeat(1000))).toBe(true)
  })
})
