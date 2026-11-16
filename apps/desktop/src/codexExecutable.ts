/**
 * Which Codex executable to run, for main's "Set up Juno" check and the
 * agent's Codex provider.
 *
 * On the Mac it is `codex`, found on `PATH` when it is spawned, as before.
 *
 * On Windows `npm i -g @openai/codex` installs `codex.cmd`, a batch file
 * that runs `node bin/codex.js`, which only spawns the package's native
 * `codex.exe` (checked with 0.169). Node will not spawn a `.cmd` without a
 * shell, and the Codex SDK spawns its path directly, so this finds the
 * native binary instead: the first `codex` on `PATH` in `PATHEXT` order, and
 * for an npm shim the `codex.exe` its package ships. A shim whose binary is
 * missing (another package manager's layout) is skipped. When nothing is
 * found it answers `codex`, whose spawn fails with ENOENT, which reads as
 * not installed.
 */
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

export interface FindCodexOptions {
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly env?: { readonly PATH?: string | undefined; readonly PATHEXT?: string | undefined }
  readonly exists?: (path: string) => boolean
}

const TRIPLES: Readonly<Record<string, string>> = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }
/** What `PATHEXT` may add that Juno can use: a binary, or an npm shim that leads to one. */
const USABLE = ['.exe', '.cmd', '.bat']

export function findCodex({ platform = process.platform, arch = process.arch, env = process.env, exists = existsSync }: FindCodexOptions = {}): string {
  if (platform !== 'win32') return 'codex'
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.toLowerCase())
    .filter((extension) => USABLE.includes(extension))
  const dirs = (env.PATH ?? '').split(';').map((dir) => dir.trim().replace(/^"(.*)"$/, '$1')).filter((dir) => dir !== '')
  for (const dir of dirs) {
    for (const extension of extensions) {
      if (!exists(win32.join(dir, `codex${extension}`))) continue
      if (extension === '.exe') return win32.join(dir, 'codex.exe')
      const native = npmBinary(dir, arch, exists)
      if (native !== undefined) return native
    }
  }
  return 'codex'
}

/** The native `codex.exe` beside an npm shim in `dir`, where `bin/codex.js` looks: the platform package, nested or hoisted, then the package's own `vendor`. */
function npmBinary(dir: string, arch: string, exists: (path: string) => boolean): string | undefined {
  const triple = TRIPLES[arch]
  if (triple === undefined) return undefined
  const modules = win32.join(dir, 'node_modules', '@openai')
  const vendors = [
    win32.join(modules, 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor'),
    win32.join(modules, `codex-win32-${arch}`, 'vendor'),
    win32.join(modules, 'codex', 'vendor'),
  ]
  return vendors.map((vendor) => win32.join(vendor, triple, 'bin', 'codex.exe')).find((binary) => exists(binary))
}
