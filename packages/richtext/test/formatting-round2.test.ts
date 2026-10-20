import { expect, it } from 'vitest'
import type { RichTextBlock, RichTextElement } from '@juno/slack-schema'
import { composeEdit, composeOutgoing, editMarkup, toggleMarkup } from '../src/index'

const paragraph = (text: string): RichTextElement => ({ type: 'rich_text_section', elements: [{ type: 'text', text }] })
const original = (elements: RichTextElement[]) => ({ blocks: [{ type: 'rich_text' as const, elements }] })

it.each(['```\nfirst\nsecond\n```', '> first\nsecond', '`first`\nsecond'])('parses the entire changed paragraph: %s', (input) => {
  expect(composeEdit(input, original([paragraph('first\nsecond')])).blocks).toEqual(composeOutgoing(input).blocks)
})
it('keeps invisible elements in an untouched paragraph', () => {
  const canvas: RichTextElement = { type: 'rich_text_section', elements: [{ type: 'unknown', raw: { type: 'canvas', file_id: 'FTEST' } }] }
  expect(composeEdit('\nchanged', original([canvas, paragraph('end')])).blocks[0]?.elements[0]).toEqual(canvas)
})
it('parses duplicate labels in a changed paragraph without reusing individual elements', () => {
  const source = original([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'same ' }, { type: 'text', text: 'same', style: { bold: true } }] }])
  const edited = '*same* same!'
  expect(composeEdit(edited, source).blocks).toEqual(composeOutgoing(edited).blocks)
})
it('keeps an unchanged list item when another item changes', () => {
  const list: RichTextElement = { type: 'rich_text_list', style: 'ordered', indent: 1, elements: [paragraph('first'), paragraph('second')].filter((el) => el.type === 'rich_text_section') }
  expect(composeEdit('changed\nsecond', original([list])).blocks[0]?.elements).toEqual([paragraph('changed'), { ...list, elements: [list.elements[1]], offset: 1 }])
})
it.each([String.raw`\\fileserver\share`, String.raw`\*.ts`, String.raw`¯\_(ツ)_/¯`, String.raw`\*word*`])('does not consume backslashes in %s', (text) => {
  const expected = text === String.raw`¯\_(ツ)_/¯` ? [{ type: 'text', text: '¯\\' }, { type: 'text', text: '(ツ)', style: { italic: true } }, { type: 'text', text: '/¯' }] : text === String.raw`\*word*` ? [{ type: 'text', text: '\\' }, { type: 'text', text: 'word', style: { bold: true } }] : [{ type: 'text', text }]
  expect(composeOutgoing(text).blocks[0]?.elements).toEqual([{ type: 'rich_text_section', elements: expected }])
  expect(editMarkup(original([paragraph(text)]))).toBe(text)
})
it('writes one marker pair for adjacent elements with the same style', () => {
  const blocks: RichTextBlock[] = [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'ship it', style: { bold: true } }, { type: 'emoji', name: 'rocket', unicode: '1f680', style: { bold: true } }] }] }]
  expect(editMarkup({ blocks })).toBe('*ship it🚀*')
})
it.each([
  ['  first\n  second\nnext', 0, 17, '```\n  first\n  second\n```\nnext'],
  ['\n  first\n  second\n', 0, 18, '\n```\n  first\n  second\n```\n'],
  ['  first\n  second next', 0, 16, '```\n  first\n  second\n```\n next'],
] as const)('code selections trim only edge line breaks: %s', (text, start, end, expected) => {
  const edit = toggleMarkup(text, { start, end }, 'code')!
  expect(text.slice(0, edit.start) + edit.insert + text.slice(edit.end)).toBe(expected)
})
