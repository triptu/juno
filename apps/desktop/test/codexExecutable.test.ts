// Finding Codex on Windows: npm's shim is a batch file Node will not spawn, so the
// resolver must reach the native binary the package ships, in PATH and PATHEXT order.
import { expect, it } from 'bun:test'
import { findCodex } from '../src/codexExecutable'

const NPM = 'C:\\npm\\prefix'
// The layout `npm i -g @openai/codex` 0.169 left on Windows Server 2022.
const NPM_BINARY = `${NPM}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`

function onWindows(files: ReadonlyArray<string>, PATH: string) {
  const present = new Set(files.map((file) => file.toLowerCase()))
  return findCodex({
    platform: 'win32',
    arch: 'x64',
    env: { PATH, PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC' },
    exists: (path) => present.has(path.toLowerCase()),
  })
}

it('runs the native binary behind npm’s codex.cmd, and the first codex on PATH wins', () => {
  expect(onWindows([`${NPM}\\codex`, `${NPM}\\codex.cmd`, NPM_BINARY], `C:\\Windows\\system32;${NPM}`)).toBe(NPM_BINARY)
  // A standalone codex.exe earlier on PATH is taken as it is.
  expect(onWindows([`${NPM}\\codex.cmd`, NPM_BINARY, 'C:\\Tools\\codex.exe'], `"C:\\Tools";${NPM}`)).toBe('C:\\Tools\\codex.exe')
  // A shim whose binary is missing is passed over for a later install.
  expect(onWindows(['C:\\pnpm\\codex.cmd', `${NPM}\\codex.cmd`, NPM_BINARY], `C:\\pnpm;${NPM}`)).toBe(NPM_BINARY)
})

it('answers plain codex when nothing usable is installed, and always on the Mac', () => {
  expect(onWindows([`${NPM}\\codex.cmd`, `${NPM}\\codex`], NPM)).toBe('codex')
  expect(findCodex({ platform: 'darwin', env: { PATH: '/opt/homebrew/bin' }, exists: () => true })).toBe('codex')
})
