/**
 * `launch.json` as main reads it before the window exists (`src/main/launch.ts`): each field falls back on its
 * own, so a file from another version keeps privacy mode and the theme, and a file main cannot parse gives the
 * defaults rather than no window. What main does with the values is the relaunch journey (`e2e/relaunch.spec.ts`).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { readLaunch } from '../src/main/launch'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

function withLaunch(text: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'juno-launch-'))
  folders.push(folder)
  writeFileSync(join(folder, 'launch.json'), text)
  return folder
}

it('keeps every field it can read when one it cannot is beside them, as after going back to an older version', () => {
  const launch = readLaunch(withLaunch(JSON.stringify({ theme: 'dark', privacy: true, accent: 'ultraviolet', sidebar: { width: 344, collapsed: true }, bounds: { x: 10, y: 20, width: 1.5, height: 760 } })))
  expect(launch).toEqual({ theme: 'dark', privacy: true, sidebar: { width: 344, collapsed: true } })
})

it('gives the defaults for a file it cannot parse, or one that is not an object', () => {
  for (const text of ['{"theme":', '[]', 'null', '']) expect(readLaunch(withLaunch(text)).theme).toBe('system')
})
