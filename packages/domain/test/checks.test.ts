import { describe, expect, it } from 'vitest'
import { audienceCheck, clarityCheck } from '../src/index'
import { eng, hiring, maya } from './fixtures'

describe('clarity check', () => {
  it('sends clean text without a check', () => {
    expect(clarityCheck('Friday works for me.')).toBeUndefined()
    expect(clarityCheck('Can you take a look?')).toBeUndefined()
  })

  it('fixes typos from the table, keeping the capital', () => {
    const r = clarityCheck('Did you recieve it? Recieve again.')
    expect(r?.fixes.map((f) => f.label)).toEqual(['recieve → receive', 'Recieve → Receive'])
    expect(r?.fixed).toBe('Did you receive it? Receive again.')
  })

  it('removes doubled words', () => {
    const r = clarityCheck('I think the the plan is fine.')
    expect(r?.fixes.map((f) => f.label)).toEqual(['the the → the'])
    expect(r?.fixed).toBe('I think the plan is fine.')
    expect(clarityCheck('He had had enough.')).toBeUndefined()
  })

  it('capitalises a lone lowercase i', () => {
    const r = clarityCheck("i think i'll do it, if i can.")
    expect(r?.fixes.map((f) => f.label)).toEqual(['i → I'])
    expect(r?.fixed).toBe("I think I'll do it, if I can.")
    expect(clarityCheck('see i.e. the doc')).toBeUndefined()
  })

  it('adds a missing question mark to a question', () => {
    const r = clarityCheck('Can we ship this on Friday')
    expect(r?.fixes.map((f) => f.label)).toEqual(['add ?'])
    expect(r?.fixed).toBe('Can we ship this on Friday?')
    expect(clarityCheck('Can we ship this on Friday.')?.fixed).toBe('Can we ship this on Friday?')
    // Short exclamations and non-questions are left alone.
    expect(clarityCheck('Can do')).toBeUndefined()
    expect(clarityCheck('We ship on Friday')).toBeUndefined()
  })

  it('summarises the fixes as the bar shows them', () => {
    const r = clarityCheck('Did you recieve the the invite')
    expect(r?.summary).toBe('3 fixes: recieve → receive, the the → the, add ?')
    expect(r?.confidence).toBeGreaterThan(0)
    expect(r?.confidence).toBeLessThanOrEqual(1)
    expect(r?.primaryLabel).toBe('Fix and send')
    expect(r?.secondaryLabel).toBe('Send as is')
    expect(clarityCheck('teh plan')?.summary).toBe('1 fix: teh → the')
  })

  it('notes a sentence over 40 words without rewriting it', () => {
    const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ') + '.'
    const r = clarityCheck(long)
    expect(r?.fixes).toEqual([])
    expect(r?.fixed).toBe(long)
    expect(r?.longSentence).toBe(true)
    expect(r?.summary).toBe('Reads a bit long. One sentence runs over 40 words.')
    // A note with nothing to fix is less certain than a table fix.
    expect(r?.confidence).toBeLessThan(clarityCheck('teh plan')!.confidence)
    expect(r?.primaryLabel).toBe('Send')
    expect(r?.secondaryLabel).toBe('Keep editing')
  })

  it('combines fixes with the long-sentence note', () => {
    const long = 'teh ' + Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ') + '.'
    expect(clarityCheck(long)?.summary).toBe('1 fix: teh → the · One sentence runs over 40 words.')
  })

  it('leaves quotes, code, urls, emails, mentions and emoji alone', () => {
    const text = '> teh original the the\n`teh` and https://example.com/teh teh@example.com @Teh Person :teh: stays'
    const r = clarityCheck(text)
    expect(r).toBeUndefined()
    const fenced = '```\nteh code\n```\nteh prose'
    expect(clarityCheck(fenced)?.fixed).toBe('```\nteh code\n```\nthe prose')
  })

  it('puts the question mark on the reply, not on a quote', () => {
    const r = clarityCheck('> are we done\nCan we ship this on Friday')
    expect(r?.fixed).toBe('> are we done\nCan we ship this on Friday?')
  })
})

describe('audience check', () => {
  it('warns about hiring or people details in a public channel', () => {
    const r = audienceCheck("Let's discuss the candidate's salary before the offer", eng)
    expect(r?.matched).toEqual(['candidate', 'salary', 'offer'])
    expect(r?.message).toBe('This reads like hiring or people detail. eng is a public channel.')
  })

  it('stays quiet in private channels and DMs, and for ordinary text', () => {
    expect(audienceCheck('candidate salary', hiring)).toBeUndefined()
    expect(audienceCheck('candidate salary', maya)).toBeUndefined()
    expect(audienceCheck('the compiler is slow', eng)).toBeUndefined()
    expect(audienceCheck('', eng)).toBeUndefined()
  })

  it('matches whole words only', () => {
    expect(audienceCheck('compose the offering', eng)).toBeUndefined()
    expect(audienceCheck('new headcount for Q1', eng)?.matched).toEqual(['headcount'])
    expect(audienceCheck('performance review tomorrow', eng)?.matched).toEqual(['performance review'])
  })
})
