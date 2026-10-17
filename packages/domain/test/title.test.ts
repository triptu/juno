import { describe, expect, it } from 'vitest'
import { channelKindLabel, channelLabel, contextPillText, contextTint, firstWords, mainLabel, manualTitleAfterRename, resolveTitle } from '../src/index'
import { eng, group, hiring, maya, topic } from './fixtures'

describe('title resolution', () => {
  it('prefers a manual title, then the AI title, then the first six words', () => {
    const text = 'Has anyone looked at the staging bill? It doubled since August.'
    expect(resolveTitle(topic({ firstMessageText: text, overlay: { manualTitle: 'Staging bill', aiTitle: 'Staging bill doubled since August' } }))).toEqual({ text: 'Staging bill', source: 'manual', sensitive: false })
    expect(resolveTitle(topic({ firstMessageText: text, overlay: { aiTitle: 'Staging bill doubled since August' } }))).toEqual({ text: 'Staging bill doubled since August', source: 'ai', sensitive: false })
    expect(resolveTitle(topic({ firstMessageText: text }))).toEqual({ text: 'Has anyone looked at the staging…', source: 'fallback', sensitive: true })
  })

  it('treats blank manual and AI titles as missing', () => {
    expect(resolveTitle(topic({ firstMessageText: 'short one', overlay: { manualTitle: '  ', aiTitle: '' } }))).toEqual({ text: 'short one', source: 'fallback', sensitive: true })
  })

  it('uses the channel label for Main rows and for threads with no text', () => {
    expect(resolveTitle(topic({ kind: 'main', channel: eng, overlay: { aiTitle: 'ignored' } }))).toEqual({ text: '#eng', source: 'channel', sensitive: false })
    expect(resolveTitle(topic({ kind: 'main', channel: maya }))).toEqual({ text: 'Maya Chen', source: 'channel', sensitive: false })
    expect(resolveTitle(topic({ channel: hiring }))).toEqual({ text: '#hiring', source: 'channel', sensitive: false })
  })

  it('marks message text nobody checked for a shared screen as sensitive', () => {
    const text = 'Go with 100k for Donna, she asked for 110k.'
    expect(resolveTitle(topic({ firstMessageText: text })).sensitive).toBe(true)
    expect(resolveTitle(topic({ firstMessageText: text, overlay: { aiTitle: 'Donna offer at 100k', aiTitleOld: true } }))).toEqual({ text: 'Donna offer at 100k', source: 'ai', sensitive: true })
    expect(resolveTitle(topic({ firstMessageText: text, overlay: { aiTitle: 'Comp discussion for Donna' } })).sensitive).toBe(false)
    expect(resolveTitle(topic({ firstMessageText: text, overlay: { manualTitle: 'Donna 100k', aiTitle: 'Donna offer at 100k', aiTitleOld: true } })).sensitive).toBe(false)
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
    // Slack's text is escaped: entities decode, links read as their label, a quote line is still dropped.
    ['is the granola mcp -&gt; action items flow live?', 'is the granola mcp -> action…'],
    ['a &lt; b &amp;&amp; c', 'a < b && c'],
    ['&gt; quoted line\nactual reply here', 'actual reply here'],
    ['see <https://example.com/x?a=1&amp;b=2|the doc> now', 'see the doc now'],
    ['*Heads up*: deploy at 2pm', 'Heads up: deploy at 2pm'],
  ])('%j → %j', (text, expected) => {
    expect(firstWords(text)).toBe(expected)
  })

  it('names the people a title mentions, and never shows their id', () => {
    expect(firstWords('<@U0MAYA> can you review the doc today', 6, { user: (id) => (id === 'U0MAYA' ? 'Maya' : undefined) })).toBe('@Maya can you review the doc…')
    expect(firstWords('<@U0MAYA> can you review')).toBe('@Someone can you review')
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
