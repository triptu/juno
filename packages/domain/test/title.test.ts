import { describe, expect, it } from 'vitest'
import { canUseAiTitle, channelKindLabel, channelLabel, contextPillText, contextTint, firstWords, mainLabel, manualTitleAfterRename, resolveTitle, showsAiSparkle } from '../src/index'
import { eng, group, hiring, maya, topic } from './fixtures'

describe('title resolution', () => {
  it('prefers a manual title, then the AI title, then the first six words', () => {
    const text = 'Has anyone looked at the staging bill? It doubled since August.'
    expect(resolveTitle(topic({ firstMessageText: text, overlay: { manualTitle: 'Staging bill', aiTitle: 'Staging bill doubled since August' } }))).toEqual({ text: 'Staging bill', source: 'manual' })
    expect(resolveTitle(topic({ firstMessageText: text, overlay: { aiTitle: 'Staging bill doubled since August' } }))).toEqual({ text: 'Staging bill doubled since August', source: 'ai' })
    expect(resolveTitle(topic({ firstMessageText: text }))).toEqual({ text: 'Has anyone looked at the staging…', source: 'fallback' })
  })

  it('treats blank manual and AI titles as missing', () => {
    expect(resolveTitle(topic({ firstMessageText: 'short one', overlay: { manualTitle: '  ', aiTitle: '' } }))).toEqual({ text: 'short one', source: 'fallback' })
  })

  it('uses the channel label for Main rows and for threads with no text', () => {
    expect(resolveTitle(topic({ kind: 'main', channel: eng, overlay: { aiTitle: 'ignored' } }))).toEqual({ text: '#eng', source: 'channel' })
    expect(resolveTitle(topic({ kind: 'main', channel: maya }))).toEqual({ text: 'Maya Chen', source: 'channel' })
    expect(resolveTitle(topic({ channel: hiring }))).toEqual({ text: '#hiring', source: 'channel' })
  })

  it('shows the sparkle only for AI titles while AI assist is on', () => {
    const ai = topic({ overlay: { aiTitle: 'A title' } })
    expect(showsAiSparkle(ai, true)).toBe(true)
    expect(showsAiSparkle(ai, false)).toBe(false)
    expect(showsAiSparkle(topic({ overlay: { aiTitle: 'A title', manualTitle: 'Mine' } }), true)).toBe(false)
  })

  it('offers "Use AI title" only when a manual title hides an AI title', () => {
    expect(canUseAiTitle(topic({ overlay: { aiTitle: 'A', manualTitle: 'B' } }), true)).toBe(true)
    expect(canUseAiTitle(topic({ overlay: { aiTitle: 'A', manualTitle: 'B' } }), false)).toBe(false)
    expect(canUseAiTitle(topic({ overlay: { manualTitle: 'B' } }), true)).toBe(false)
    expect(canUseAiTitle(topic({ kind: 'main', overlay: { aiTitle: 'A', manualTitle: 'B' } }), true)).toBe(false)
  })
})

describe('first words', () => {
  it.each([
    ['one two three four five six seven', 'one two three four five six…'],
    ['one two three four five six', 'one two three four five six'],
    ['  spaced   out  words ', 'spaced out words'],
    ['> quoted line\nactual reply here', 'actual reply here'],
    ['line one\nline two', 'line one line two'],
    ['', ''],
    // A cut on the end of a sentence keeps the sentence, never "doc.…".
    ['Draft plan is in the doc. Short version: logical replication.', 'Draft plan is in the doc'],
    ['p95 on /v2/search jumped to 1.8s. Looking now.', 'p95 on /v2/search jumped to 1.8s'],
    ['Can we ship the pricing today? Legal is fine.', 'Can we ship the pricing today?'],
    ['We have 142 flags and still... more coming', 'We have 142 flags and still...'],
    // A cut after a comma, colon or dash drops the mark before the ellipsis.
    ['Two options for the cutover window, both tested', 'Two options for the cutover window…'],
    ['Heads up on the deploy freeze: starts Friday', 'Heads up on the deploy freeze…'],
    ['one two three four five six – seven', 'one two three four five six…'],
    // A text that is not cut keeps its punctuation.
    ['Final copy for pricing is in.', 'Final copy for pricing is in.'],
  ])('%j → %j', (text, expected) => {
    expect(firstWords(text)).toBe(expected)
  })
})

describe('rename', () => {
  it('saves trimmed text', () => {
    expect(manualTitleAfterRename('  Pricing page  ', 'AI title')).toBe('Pricing page')
  })

  it('clears the manual title on empty input or the AI title text', () => {
    expect(manualTitleAfterRename('   ', 'AI title')).toBeUndefined()
    expect(manualTitleAfterRename('AI title', 'AI title')).toBeUndefined()
    expect(manualTitleAfterRename('AI title', undefined)).toBe('AI title')
  })
})

describe('channel labels', () => {
  it('prints #name, a person, or first names of a group DM', () => {
    expect(channelLabel(eng)).toBe('#eng')
    expect(channelLabel(hiring)).toBe('#hiring')
    expect(channelLabel(maya)).toBe('Maya Chen')
    expect(channelLabel(group)).toBe('Maya, Leo')
  })

  it('labels Main as "#eng · Main" and the context pill without the hash', () => {
    expect(mainLabel(eng)).toBe('#eng · Main')
    expect(mainLabel(maya)).toBe('Maya Chen · Main')
    expect(contextPillText(eng)).toBe('eng · Public channel')
    expect(contextPillText(hiring)).toBe('hiring · Private channel')
    expect(contextPillText(maya)).toBe('Maya Chen · Direct message')
    expect(contextPillText(group)).toBe('Maya, Leo · Group DM')
  })

  it('tints public neutral, private amber and DMs blue', () => {
    expect(contextTint('public')).toBe('public')
    expect(contextTint('private')).toBe('private')
    expect(contextTint('im')).toBe('dm')
    expect(contextTint('mpim')).toBe('dm')
    expect(channelKindLabel('mpim')).toBe('Group DM')
  })
})
