/**
 * A Slack file's name as a file Windows will save (`src/main/fileNames.ts`): Slack accepts names
 * Windows refuses, and a refused name made the download, Open and the viewer fail.
 */
import { expect, it } from 'bun:test'
import { safeFileName } from '../src/main/fileNames'

it('saves names Windows would refuse under a name it accepts', () => {
  expect(safeFileName('Q3 plan: what? "final" <v2>|*.pdf', true)).toBe('Q3 plan- what- -final- -v2---.pdf')
  expect(safeFileName('notes.txt. . ', true)).toBe('notes.txt')
  expect(safeFileName('a\tb\u0001.txt', true)).toBe('a-b-.txt')
  expect(safeFileName('CON', true)).toBe('_CON')
  expect(safeFileName('nul.tar.gz', true)).toBe('_nul.tar.gz')
  expect(safeFileName('com1.log', true)).toBe('_com1.log')
  expect(safeFileName('console.log', true)).toBe('console.log')
  expect(safeFileName('..\\..\\evil.exe', true)).toBe('-..-evil.exe')
  expect(safeFileName('...', true)).toBe('download')
})

