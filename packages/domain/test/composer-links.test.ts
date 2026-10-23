import { describe, expect, it } from 'bun:test'
import { composeOutgoing } from '@juno/richtext'
import { decodeDraft, encodeDraft, linkAt, moveLinks, pastedLink, setLink, shownLinks, type LinkRange, type MentionPick } from '../src/index'

const docs: LinkRange = { start: 4, end: 12, url: 'https://example.com/docs' }
const text = 'see the docs now'

describe('linked words as the text changes', () => {
  it('moves with typing before them and stays put for typing after them', () => {
    expect(moveLinks(text, `oh, ${text}`, [docs], 4)).toEqual([{ ...docs, start: 8, end: 16 }])
    expect(moveLinks(text, 'see the docs right now', [docs], 18)).toEqual([docs])
  })

  it('does not grow for typing at either end, and grows for typing inside', () => {
    expect(moveLinks(text, 'see the docss now', [docs], 13)).toEqual([docs])
    expect(moveLinks(text, 'see xthe docs now', [docs], 5)).toEqual([{ ...docs, start: 5, end: 13 }])
    expect(moveLinks(text, 'see the new docs now', [docs], 12)).toEqual([{ ...docs, end: 16 }])
  })

  it('goes when all its words are replaced or deleted, and keeps the rest of a partial one', () => {
    expect(moveLinks(text, 'see https://example.com/docs now', [docs])).toEqual([])
    expect(moveLinks(text, 'see  now', [docs])).toEqual([])
    expect(moveLinks(text, 'see the', [docs])).toEqual([{ ...docs, end: 7 }])
    expect(moveLinks(text, 'docs now', [docs])).toEqual([{ ...docs, start: 0, end: 4 }])
  })

  it('sets, replaces and removes a link on a range', () => {
    expect(setLink([docs], 4, 12, 'https://example.com/new')).toEqual([{ ...docs, url: 'https://example.com/new' }])
    expect(setLink([docs], 4, 12, undefined)).toEqual([])
    expect(setLink([], 0, 3, 'https://example.com')).toEqual([{ start: 0, end: 3, url: 'https://example.com' }])
  })

  it('finds the link under a click', () => {
    expect(linkAt([docs], 6)).toBe(docs)
    expect(linkAt([docs], 2)).toBeUndefined()
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

  it('takes a paste of one URL as a link and anything else as text', () => {
    expect(pastedLink('https://example.com/a')).toBe('https://example.com/a')
    expect(pastedLink('read https://example.com/a')).toBeUndefined()
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
