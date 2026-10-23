import { describe, expect, it } from 'bun:test'
import { composeOutgoing } from '@juno/richtext'
import { decodeDraft, encodeDraft, moveLinks, shownLinks, type LinkRange, type MentionPick } from '../src/index'

const docs: LinkRange = { start: 4, end: 12, url: 'https://example.com/docs' }
const text = 'see the docs now'

describe('linked words as the text changes', () => {
  // [before, after, the caret after the edit, the link before, where it is after]
  it.each<[string, string, number | undefined, LinkRange, ReadonlyArray<LinkRange>]>([
    // Typing before moves it; typing after leaves it.
    [text, `oh, ${text}`, 4, docs, [{ ...docs, start: 8, end: 16 }]],
    [text, 'see the docs right now', 18, docs, [docs]],
    // Typing at either end does not grow it; typing inside does.
    [text, 'see the docss now', 13, docs, [docs]],
    [text, 'see xthe docs now', 5, docs, [{ ...docs, start: 5, end: 13 }]],
    [text, 'see the new docs now', 12, docs, [{ ...docs, end: 16 }]],
    // Replacing or deleting all its words removes it; a partial delete keeps the rest.
    [text, 'see https://example.com/docs now', undefined, docs, []],
    [text, 'see  now', undefined, docs, []],
    [text, 'see the', undefined, docs, [{ ...docs, end: 7 }]],
    [text, 'docs now', undefined, docs, [{ ...docs, start: 0, end: 4 }]],
    // Regression: formatting applied and removed keeps the linked label.
    ['plan', '*plan*', undefined, { start: 0, end: 4, url: 'https://example.com/plan' }, [{ start: 1, end: 5, url: 'https://example.com/plan' }]],
    ['*plan*', 'plan', undefined, { start: 1, end: 5, url: 'https://example.com/plan' }, [{ start: 0, end: 4, url: 'https://example.com/plan' }]],
  ])('%j → %j', (before, after, caret, link, expected) => {
    expect(moveLinks(before, after, [link], caret)).toEqual(expected)
  })
})

describe('what the field shows as links', () => {
  it('shows typed URLs and linked words, but not a URL inside a mention', () => {
    const maya: MentionPick = { kind: 'person', id: 'U0MAYA', name: 'maya.com' }
    expect(shownLinks('the docs or example.com, @maya.com', [{ start: 0, end: 8, url: 'https://a.io' }], [maya])).toEqual([
      { start: 0, end: 8, url: 'https://a.io' },
      { start: 12, end: 23, url: 'http://example.com' },
    ])
  })
})

describe('drafts and sends', () => {
  const eng: MentionPick = { kind: 'channel', id: 'C0ENG', name: 'eng' }

  it('stores linked words as <url|words> beside mentions, and reads them back', () => {
    const field = 'in #eng see the docs & notes'
    const links = [{ start: 12, end: 28, url: 'https://example.com/a?b=1|2' }]
    const encoded = encodeDraft(field, [eng], links)
    expect(encoded).toBe('in <#C0ENG|eng> see <https://example.com/a?b=1%7C2|the docs &amp; notes>')
    expect(decodeDraft(encoded)).toEqual({ text: field, picks: [eng], links: [{ start: 12, end: 28, url: 'https://example.com/a?b=1%7C2' }] })
  })

  it('sends linked words as a link element with their text, as Slack does', () => {
    const out = composeOutgoing(encodeDraft('read the docs first', [], [{ start: 5, end: 13, url: 'https://example.com/docs' }]))
    expect(out.blocks[0]?.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'text', text: 'read ' },
        { type: 'link', url: 'https://example.com/docs', text: 'the docs' },
        { type: 'text', text: ' first' },
      ],
    })
    expect(out.text).toBe('read <https://example.com/docs|the docs> first')
  })
})
