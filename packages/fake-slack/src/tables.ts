import type { RichTextInline, TableBlock, TableColumnSetting } from '@juno/slack-schema'

/** A cell: plain words, inline elements, or `null` for an empty cell. */
type TableCellInput = string | ReadonlyArray<RichTextInline> | null

/**
 * A `table` block as Slack sends it (research section 5, "Tables"): each
 * cell a `rich_text` block with one section, an empty cell `null`, and
 * `column_settings` by column when given.
 */
export function tableBlock(rows: ReadonlyArray<ReadonlyArray<TableCellInput>>, columnSettings?: ReadonlyArray<TableColumnSetting | null>): TableBlock {
  return {
    type: 'table',
    rows: rows.map((row) => row.map((cell) => cell === null ? null : {
      type: 'rich_text',
      elements: [{ type: 'rich_text_section', elements: typeof cell === 'string' ? [{ type: 'text', text: cell }] : cell }],
    })),
    ...(columnSettings === undefined ? {} : { column_settings: columnSettings }),
  }
}
