// Fails when the Bun running the install is not the build package.json pins in
// `packageManager`. Runs as the root preinstall script. Every canary of a release
// prints the same `bun --version`, so a canary pin carries its commit after `+`
// (`bun@1.4.4-canary.20261023.1+5c6d4e24c`) and is compared with `bun --revision`
// (`1.4.4-canary.1+5c6d4e24c`; a release prints `1.4.4+38afee6c8`).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pinned = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).packageManager.replace(/^bun@/, '')
const [version, commit] = pinned.split('+')
const release = version.split('-')[0]
// During an install, npm_execpath is the Bun running it.
const revision = spawnSync(process.env.npm_execpath ?? process.execPath, ['--revision'], { encoding: 'utf8' }).stdout?.trim() ?? ''
const [runningVersion, runningCommit] = revision.split('+')
const ok = version === release
  ? runningVersion === release
  : runningVersion?.startsWith(`${release}-canary.`) && runningCommit === commit
if (!ok) {
  console.error(`Juno needs Bun ${pinned}; this is ${revision ? `Bun ${revision}` : 'not Bun'}. See "Prerequisites" in docs/development.md.`)
  process.exit(1)
}
