import { expect, it } from 'vitest'
import { composeOutgoing, markupLayout, toggleMarkup } from '../src/index'

it.each(['𠮷*bold*', '*bold*𠮷', '*bold**', '_italic__', '~strike~~'])('keeps literal boundaries in %s', (input) => {
  expect(composeOutgoing(input).blocks[0]?.elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: input }] }])
  expect(markupLayout(input).spans).toEqual([])
})

it('keeps every line’s indent when making a code block', () => {
  const text = '  first\n  second'
  expect(toggleMarkup(text, { start: 0, end: text.length }, 'code')?.insert).toBe('```\n  first\n  second\n```')
})

it('closes a style after a URL and leaves URLs inside code as text', () => {
  expect(composeOutgoing('*see https://example.com/x*').blocks[0]?.elements).toEqual([{
    type: 'rich_text_section', elements: [{ type: 'text', text: 'see ', style: { bold: true } }, { type: 'link', url: 'https://example.com/x', style: { bold: true } }],
  }])
  expect(composeOutgoing('`curl https://example.com/a`').blocks[0]?.elements).toEqual([{
    type: 'rich_text_section', elements: [{ type: 'text', text: 'curl https://example.com/a', style: { code: true } }],
  }])
})

it('expands a partial mention selection to the whole picked name', () => {
  const text = 'ask @Maya Chen now'
  const edit = toggleMarkup(text, { start: 6, end: 8 }, 'italic', [{ start: 4, end: 14 }])!
  expect(text.slice(0, edit.start) + edit.insert + text.slice(edit.end)).toBe('ask _@Maya Chen_ now')
})

it('keeps backslashes before non-code markers inside code', () => {
  expect(composeOutgoing('`\\*literal\\*`').blocks[0]?.elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: '\\*literal\\*', style: { code: true } }] }])
  expect(composeOutgoing('```\\*literal\\*```').blocks[0]?.elements).toEqual([{ type: 'rich_text_preformatted', border: 0, elements: [{ type: 'text', text: '\\*literal\\*' }] }])
})
