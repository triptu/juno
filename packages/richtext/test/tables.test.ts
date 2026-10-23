/**
 * Slack `table` blocks (research section 5, "Tables"): decoded with
 * `@juno/slack-schema` from the shape the recorded `subscriptions.thread.getView`
 * response carries, turned into a `table` block, and read by each text view.
 * The text is invented.
 */
import { Message } from '@juno/slack-schema'
import { Schema } from 'effect'
import { describe, expect, it } from 'bun:test'
import { messageBody, plainText, previewLine, previewText, readableText, tableText, type Lookups, type MessageBody } from '../src/index'

const lookups: Lookups = { me: 'U0ME', user: (id) => ({ U0ME: 'Tushar', U0MAYA: 'Maya Chen' })[id] }

const section = (...elements: ReadonlyArray<Record<string, unknown>>) => ({ type: 'rich_text', block_id: 'c', elements: [{ type: 'rich_text_section', elements }] })
const text = (value: string, style?: Record<string, boolean>) => (style === undefined ? { type: 'text', text: value } : { type: 'text', text: value, style })

/** As the recorded bot reply has it: words, a table whose cells are rich_text blocks, then more words. */
const payload = {
  type: 'message',
  user: 'U0BOT',
  bot_id: 'B0BOT',
  ts: '1760000000.000100',
  text: 'Release status',
  blocks: [
    section(text('Release status:')),
    {
      type: 'table',
      block_id: 't',
      rows: [
        [section(text('Service')), section(text('Owner')), section(text('Notes'))],
        [section(text('API')), section({ type: 'user', user_id: 'U0MAYA' }), section(text('p95 at '), text('212 ms', { code: true }))],
        [section(text('Worker', { bold: true })), null, section({ type: 'link', url: 'https://example.test/runbook', text: 'runbook' }, { type: 'emoji', name: 'warning', unicode: '26a0-fe0f' })],
      ],
      column_settings: [null, { align: 'center' }, { is_wrapped: true, align: 'justify' }],
    },
    section(text('Rollback is ready.')),
  ],
}

const decode = (value: unknown) => Schema.decodeUnknownSync(Message)(value)
const tableOf = (body: MessageBody) => body.blocks.find((block) => block.kind === 'table')

describe('table blocks', () => {
  it('decode into rows of inline cells, with the column settings Slack sends', () => {
    const body = messageBody(decode(payload), lookups)
    expect(body.blocks.map((block) => block.kind)).toEqual(['paragraph', 'table', 'paragraph'])
    expect(tableOf(body)).toEqual({
      kind: 'table',
      rows: [
        [[{ kind: 'text', text: 'Service' }], [{ kind: 'text', text: 'Owner' }], [{ kind: 'text', text: 'Notes' }]],
        [
          [{ kind: 'text', text: 'API' }],
          [{ kind: 'user', id: 'U0MAYA', name: 'Maya Chen', isMe: false }],
          [{ kind: 'text', text: 'p95 at ' }, { kind: 'text', text: '212 ms', style: { code: true } }],
        ],
        [
          [{ kind: 'text', text: 'Worker', style: { bold: true } }],
          [],
          [{ kind: 'link', url: 'https://example.test/runbook', text: 'runbook' }, { kind: 'emoji', name: 'warning', unicode: '⚠️' }],
        ],
      ],
      // An unknown alignment is dropped, so the column is left aligned; its wrap is kept.
      columns: [{}, { align: 'center' }, { wrap: true }],
    })
  })

  it.each([
    ['raw text and number cells', [[{ type: 'raw_text', text: 'Region' }, { type: 'raw_number', text: '1,204' }]], [[[{ kind: 'text', text: 'Region' }], [{ kind: 'text', text: '1,204' }]]]],
    ['a short row, filled with empty cells', [[section(text('a')), section(text('b'))], [section(text('c'))]], [[[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]], [[{ kind: 'text', text: 'c' }], []]]],
    ['a cell kind Juno does not know, by its text', [[{ type: 'action_cell', text: 'Open' }]], [[[{ kind: 'text', text: 'Open' }]]]],
    ['two sections in one cell, one line each', [[{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [text('one')] }, { type: 'rich_text_section', elements: [text('two')] }] }]], [[[{ kind: 'text', text: 'one' }, { kind: 'break' }, { kind: 'text', text: 'two' }]]]],
  ])('keep %s', (_name, rows, expected) => {
    expect(tableOf(messageBody(decode({ ...payload, blocks: [{ type: 'table', rows }] })))).toEqual({ kind: 'table', rows: expected })
  })

  it('keep a caption, shown only when Slack shows it', () => {
    const table = (extra: object) => tableOf(messageBody(decode({ ...payload, blocks: [{ type: 'table', rows: [[section(text('a'))]], ...extra }] })))
    expect(table({ caption: 'Deploys' })).toMatchObject({ caption: 'Deploys' })
    expect(table({ caption: 'Deploys' })).not.toHaveProperty('showCaption')
    expect(table({ caption: 'Deploys', is_caption_visible: true })).toMatchObject({ caption: 'Deploys', showCaption: true })
  })

  it('give nothing for a table with no rows, so the message falls back to its text', () => {
    const body = messageBody(decode({ ...payload, blocks: [{ type: 'table', rows: [] }] }))
    expect(body.blocks).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: 'Release status' }] }])
  })
})

const only = (rows: ReadonlyArray<ReadonlyArray<unknown>>) => messageBody(decode({ ...payload, blocks: [{ type: 'table', rows }] }), lookups)
const table = only([
  [section(text('Service')), section(text('Owner'))],
  [section(text('API')), section({ type: 'user', user_id: 'U0MAYA' })],
  [section(text('Worker')), null],
])

describe('text views of a table', () => {
  it.each([
    // Copy, search and Ask Juno: a row per line, cells split by tabs, so a paste lands in a spreadsheet's cells.
    ['plainText', plainText(messageBody(decode(payload), lookups)), 'Release status:\nService\tOwner\tNotes\nAPI\t@Maya Chen\tp95 at 212 ms\nWorker\t\trunbook⚠️\nRollback is ready.'],
    ['readableText', readableText(table), 'Service\tOwner\nAPI\t@Maya Chen\nWorker\t'],
    // A tab or a line break inside a cell becomes a space, so every cell stays in its column.
    // A carriage return, alone or before a line feed, becomes a space too.
    ['plainText of a cell with CR and CRLF', plainText(only([[section(text('one\rtwo')), section(text('three\r\nfour'))]])), 'one two\tthree four'],
    ['plainText of a cell with a break and a tab', plainText(only([[{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [text('one\ttwo')] }, { type: 'rich_text_section', elements: [text('three')] }] }, section(text('x'))]])), 'one two three\tx'],
    // A message with words shows the words, as one with files does.
    ['previewText with words', previewText(messageBody(decode(payload), lookups)), 'Release status: Rollback is ready.'],
    // A message that is only a table names it by its first row with words.
    ['previewText of a table alone', previewText(table), 'Table: Service, Owner'],
    ['previewText past an empty first row', previewText(only([[null, section(text(' '))], [section(text('API')), section(text('ok'))]])), 'Table: API, ok'],
    ['previewText of a table with no words', previewText(only([[null, null]])), 'Table'],
    ['previewLine of a table alone', previewLine('Grafana', table), 'Grafana: Table: Service, Owner'],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })
})

describe('tables cached before they were decoded', () => {
  // Messages synced before tables were known were stored with the table as the schema's unknown variant.
  const cached = (raw: object) => messageBody({ text: 'Release status', blocks: [{ type: 'unknown', raw: { type: 'table', ...raw } }] }, lookups)

  it('read as tables, with their cells and settings', () => {
    const body = cached({ rows: [[section(text('Service')), section({ type: 'user', user_id: 'U0MAYA' })]], column_settings: [{ align: 'right' }] })
    expect(body.blocks).toEqual([{ kind: 'table', rows: [[[{ kind: 'text', text: 'Service' }], [{ kind: 'user', id: 'U0MAYA', name: 'Maya Chen', isMe: false }]]], columns: [{ align: 'right' }] }])
    expect(previewText(body)).toBe('Table: Service, @Maya Chen')
  })

  it('stay unknown when the stored object is not a table Juno can read', () => {
    expect(cached({ rows: 'not rows' }).blocks).toEqual([{ kind: 'paragraph', children: [{ kind: 'text', text: 'Release status' }] }])
  })
})

describe('tableText', () => {
  it('writes the given rows as tab-separated lines, for copying part of a table', () => {
    const rows = tableOf(table)!.rows
    expect(tableText(rows.slice(1, 3))).toBe('API\t@Maya Chen\nWorker\t')
  })
})
