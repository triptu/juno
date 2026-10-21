import type { Inline } from './model'
import { inlineText } from './inline'

/**
 * Rows of a table as a spreadsheet takes them: one line per row, cells split
 * by tabs. A tab, line feed or carriage return inside a cell becomes a space,
 * so every cell stays in its column. `plainText` uses it for a whole table;
 * the view uses it for the rows a copy selects.
 */
export function tableText(rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<Inline>>>): string {
  return rows.map((row) => row.map(cellText).join('\t')).join('\n')
}

const cellText = (cell: ReadonlyArray<Inline>) => inlineText(cell).replace(/[\t\r\n]+/g, ' ').trim()
