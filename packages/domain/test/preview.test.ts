import { describe, expect, it } from 'bun:test'
import type { File } from '@juno/slack-schema'
import { messagePreviewText, previewSender, shortName, namesakes, type PreviewPerson } from '../src/index'

const image = (id: string, name = `${id}.png`): File => ({ id, name, mimetype: 'image/png' })
const pdf: File = { id: 'F0PDF', name: 'report.pdf', title: 'report.pdf', mimetype: 'application/pdf' }

describe('preview text', () => {
  it('uses the words of a message, with or without files', () => {
    expect(messagePreviewText({ text: 'Here is the mock' })).toBe('Here is the mock')
    expect(messagePreviewText({ text: 'Here is the mock', files: [image('F1')] })).toBe('Here is the mock')
  })

  it('shows a code block without its language tag line', () => {
    const tagged = { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'ts\nconst tries = 3\nretry(tries)' }] } as const
    expect(messagePreviewText({ text: '```ts\nconst tries = 3\nretry(tries)```', blocks: [{ type: 'rich_text', elements: [tagged] }] })).toBe('const tries = 3 retry(tries)')
    expect(messagePreviewText({ text: '```ts\nconst tries = 3\n```' })).toBe('const tries = 3')
  })

  it('labels a message that is only files by what they are', () => {
    // A fresh upload Slack has not typed yet: its name says what it is.
    expect(messagePreviewText({ text: '', files: [{ id: 'F0NEW', name: 'shot.png', mimetype: '', filetype: '' }] })).toBe('Image')
    // Files of one kind are counted by that kind; mixed kinds are counted as files.
    expect(messagePreviewText({ text: '', files: [image('F1'), image('F2')] })).toBe('2 images')
    expect(messagePreviewText({ text: '', files: [image('F1'), pdf] })).toBe('2 files')
    expect(messagePreviewText({ text: '', files: [pdf] })).toBe('File: report.pdf')
  })

  it('names a link alone by its domain, but keeps a link inside words', () => {
    expect(messagePreviewText({ text: '<https://www.example.com/a/b?c=1>' })).toBe('Link: example.com')
    expect(messagePreviewText({ text: 'See <https://example.com>' })).toBe('See https://example.com')
  })

  it('reads a shared message, a bot attachment and an unfurl', () => {
    expect(messagePreviewText({ text: '', attachments: [{ is_msg_unfurl: true, text: 'Ship it on Friday' }] })).toBe('Shared message: Ship it on Friday')
    expect(messagePreviewText({ text: '', attachments: [{ message_blocks: [] }] })).toBe('Shared message')
    expect(messagePreviewText({ text: '', attachments: [{ is_share: true, channel_id: 'C0ENG', text: 'Ship it on Friday' }] })).toBe('Shared message: Ship it on Friday')
    expect(messagePreviewText({ text: '', attachments: [{ title: 'Build 412 passed', text: 'All green' }] })).toBe('Build 412 passed')
    expect(messagePreviewText({ text: '', attachments: [{ fallback: '[FIRING] disk 90%' }] })).toBe('[FIRING] disk 90%')
    expect(messagePreviewText({ text: '', attachments: [{ from_url: 'https://docs.example.org/page' }] })).toBe('Link: docs.example.org')
  })

  it("names a shared message of only files by its files, not Slack's fallback line", () => {
    const fallback = '[October 19th, 2026 3:23 PM] Maya: demo.mov'
    expect(messagePreviewText({ text: '', attachments: [{ is_share: true, fallback, files: [{ id: 'F0CLIP', name: 'demo.mov', mimetype: 'video/quicktime' }] }] })).toBe('Shared message: Video')
    expect(messagePreviewText({ text: '', attachments: [{ is_share: true, fallback, files: [{ id: 'F0PLAN', name: 'plan.pdf', mimetype: 'application/pdf' }] }] })).toBe('Shared message: File: plan.pdf')
    expect(messagePreviewText({ text: '', attachments: [{ is_share: true, fallback }] })).toBe(`Shared message: ${fallback}`)
  })

  it('names a message that is only a table by its first row, and keeps the words of one with words', () => {
    const cell = (text: string) => ({ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] }) as const
    const table = { type: 'table', rows: [[cell('Service'), cell('Status')], [cell('API'), cell('Healthy')]] } as const
    expect(messagePreviewText({ text: 'Release status', blocks: [table] })).toBe('Table: Service, Status')
    expect(messagePreviewText({ text: 'Release status', blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Release status:' }] }] }, table] })).toBe('Release status:')
  })

  it('keeps an emoji-only message as its emoji', () => {
    expect(messagePreviewText({ text: ':tada:' })).toBe('🎉')
  })

  it('is never empty for a message that exists', () => {
    expect(messagePreviewText({ text: '' })).toBe('Message')
    expect(messagePreviewText({ text: '   ' })).toBe('Message')
    expect(messagePreviewText({ text: '', files: [], attachments: [{}] })).toBe('Message')
    // Only a quote: what it quotes, rather than nothing.
    expect(messagePreviewText({ text: '&gt; the old plan' })).toBe('the old plan')
    // A reply under a quote keeps only the reply.
    expect(messagePreviewText({ text: '&gt; the old plan\nNew plan' })).toBe('New plan')
  })
})

const maya: PreviewPerson = { id: 'U0MAYA', name: 'Maya Chen' }
const alexK: PreviewPerson = { id: 'U0ALEXK', name: 'Alex', realName: 'Alex Kim' }
const alexR: PreviewPerson = { id: 'U0ALEXR', name: 'alex rivera' }

describe('preview sender', () => {
  it('reads "You" for my messages, in every kind of conversation', () => {
    for (const kind of ['im', 'mpim', 'public', 'private'] as const) expect(previewSender({ kind, mine: true, person: maya })).toBe('You')
  })

  it('names nobody for the other side of a one-to-one DM', () => {
    expect(previewSender({ kind: 'im', mine: false, person: maya })).toBe('')
    expect(previewSender({ kind: 'im', mine: false, botName: 'Deploy Bot' })).toBe('')
  })

  it('uses first names in group DMs and channels', () => {
    expect(previewSender({ kind: 'mpim', mine: false, person: maya })).toBe('Maya')
    expect(previewSender({ kind: 'public', mine: false, person: maya })).toBe('Maya')
    expect(previewSender({ kind: 'private', mine: false, person: { id: 'U0X', name: 'Priya' } })).toBe('Priya')
  })

  it('adds a last initial when two people share a first name', () => {
    expect(previewSender({ kind: 'public', mine: false, person: alexK, others: [alexR, maya] })).toBe('Alex K')
    expect(previewSender({ kind: 'mpim', mine: false, person: alexR, others: [alexK] })).toBe('alex R')
    // Nobody else called Alex: the first name alone.
    expect(previewSender({ kind: 'public', mine: false, person: alexK, others: [maya, alexK] })).toBe('Alex')
    // A one-word name with a namesake and no full name: the whole name.
    expect(shortName({ id: 'U0A', name: 'Alex' }, [alexK])).toBe('Alex')
  })

  it('finds the namesakes to store with the preview', () => {
    expect(namesakes(alexK, [alexK, alexR, maya])).toEqual(['U0ALEXR'])
    expect(namesakes(maya, [alexK, alexR, maya])).toEqual([])
  })

  it('keeps a bot or app name whole', () => {
    expect(previewSender({ kind: 'public', mine: false, botName: 'Deploy Bot' })).toBe('Deploy Bot')
  })

  it('keeps a name whose first word is not a name whole', () => {
    expect(previewSender({ kind: 'public', mine: false, person: { id: 'U0U', name: '🦄 Unicorn' } })).toBe('🦄 Unicorn')
    expect(previewSender({ kind: 'public', mine: false, person: { id: 'U0P', name: '🎉' } })).toBe('🎉')
  })
})
