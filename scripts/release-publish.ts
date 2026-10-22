#!/usr/bin/env node
/**
 * Publishes a built release to the private releases repository (docs/development.md,
 * "Releasing"). Run with `pnpm release:publish -- --notes <file>` after `pnpm package`.
 *
 * It uses `gh` with the local login; no token is read, printed or written here.
 * Steps: check the build in apps/desktop/release matches the version in
 * apps/desktop/package.json and carries the updater's config, check the version is
 * newer than every published release, create a draft release `v<version>` with the
 * DMG, block map and latest-mac.yml (also ZIP for signed builds), add the notes to CHANGELOG.md, then
 * publish the draft. The app only sees a release once it is published.
 *
 * Flags:
 *   --notes <file>   the highlights of this version, one per line, at most ten (required)
 *   --urgent         publish after typecheck, lint, unit tests and package smoke; start pnpm verify:main for it next
 *   --prerelease     publish as a pre-release: the app never offers it, and CHANGELOG.md is left alone
 *   --dry-run        check everything and print the plan; change nothing
 *   --dir <path>     the build folder (default apps/desktop/release)
 *   --repo <o/r>     the releases repository (default triptu/juno-releases)
 */
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { addChangelogEntry, compareVersions, isVersion, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'
import { releaseGate, printGate } from './release-gate.mjs'
import { highlightLines } from './release-schedule.mjs'
import { syncReleasedVersion } from './release-main.mjs'
import { recordReleaseTiming } from './release-timings.mjs'

const scriptRoot = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    notes: { type: 'string' },
    checkout: { type: 'string', default: scriptRoot },
    source: { type: 'string' },
    urgent: { type: 'boolean', default: false },
    prerelease: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    dir: { type: 'string' },
    repo: { type: 'string', default: 'triptu/juno-releases' },
  },
})
const root = resolve(values.checkout)
const dry = values['dry-run']
const repo = values.repo
const dir = resolve(values.dir ?? join(root, 'apps/desktop/release'))
const urgent = values.urgent
const buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sourceCommit = values.source ?? buildCommit
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) fail('source must be a full commit id')
execFileSync('git', ['merge-base', '--is-ancestor', sourceCommit, buildCommit], { cwd: root })

function fail(message: string): never {
  console.error(`release:publish: ${message}`)
  process.exit(1)
}

function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] })
}

// The version and the notes.
const version = String(JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).version)
if (!isVersion(version) || normalizeVersion(version) !== version) fail(`apps/desktop/package.json has "${version}", not a plain semver version`)
const tag = `v${version}`
// The repository.
gh(['auth', 'status'])
const releases = JSON.parse(gh(['release', 'list', '--repo', repo, '--limit', '200', '--json', 'tagName,isDraft,isPrerelease'])) as Array<{ tagName: string; isDraft: boolean; isPrerelease: boolean }>
const published = releases.find((release) => release.tagName === tag && !release.isDraft && !release.isPrerelease)
if (published && !values.prerelease) {
  if (!dry) syncReleasedVersion(root, version)
  console.log(`release:publish: ${tag} is already published; only the main version update was needed`)
  process.exit(0)
}
if (values.notes === undefined) fail('--notes <file> is required: the highlights of this version')
let lines: readonly string[] = []
try {
  lines = highlightLines(readFileSync(values.notes, 'utf8'))
} catch (error) {
  fail(`${values.notes}: ${(error as Error).message}`)
}

// The build.
if (!existsSync(join(dir, 'latest-mac.yml'))) fail(`no latest-mac.yml in ${dir}; run pnpm package first`)
const metadata = readFileSync(join(dir, 'latest-mac.yml'), 'utf8')
const built = /^version:\s*['"]?([^'"\s]+)/m.exec(metadata)?.[1]
if (built !== version) fail(`latest-mac.yml is for ${built ?? 'no version'}, package.json says ${version}; rebuild`)
const files = readdirSync(dir).filter((name) => name === 'latest-mac.yml' || (name.includes(`-${version}`) && /\.(dmg|zip|blockmap)$/.test(name)))
const urls = [...metadata.matchAll(/^\s*-?\s*url:\s*(\S+)/gm)].map((match) => match[1]!)
for (const url of urls) if (!files.includes(url)) fail(`latest-mac.yml names ${url}, which is not in ${dir}`)
const dmg = files.find((name) => name.endsWith('.dmg'))
if (dmg === undefined || !urls.includes(dmg)) fail(`latest-mac.yml must name the DMG for ${version}`)
if (!files.includes(`${dmg}.blockmap`)) fail(`no DMG block map for ${version} in ${dir}`)

// The updater's config must be in the app, or installs of this version never update again.
const asar = join(dir, 'mac-arm64/Juno.app/Contents/Resources/app.asar')
if (existsSync(asar)) {
  const head = Buffer.alloc(4 * 1024 * 1024)
  const fd = openSync(asar, 'r')
  const read = readSync(fd, head, 0, head.length, 0)
  closeSync(fd)
  if (!head.subarray(0, read).includes('"update.json"')) fail('the app has no update.json; package with JUNO_UPDATE_TOKEN set')
} else {
  console.warn(`release:publish: ${asar} is missing, so the updater config could not be checked`)
}
let signed = false
try {
  signed = execFileSync('codesign', ['-dv', '--verbose=2', join(dir, 'mac-arm64/Juno.app')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).includes('Developer ID Application')
} catch (error) {
  signed = String((error as { stderr?: unknown }).stderr ?? '').includes('Developer ID Application')
}
if (signed && !urls.some((url) => url.endsWith('.zip'))) fail('a signed build needs a ZIP in latest-mac.yml for in-place updates')
if (!signed && files.some((name) => name.endsWith('.zip'))) fail('an unsigned build must not upload a ZIP; rebuild with pnpm package')

if (!urgent) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) fail('commit or remove working-tree changes before publishing')
  const gate = releaseGate(root, commit)
  if (!gate) fail('no eligible full-run record for this commit; inspect pnpm verify:main results')
  printGate(gate)
}

if (releases.some((release) => release.tagName === tag)) fail(`${repo} already has ${tag}; bump the version (pnpm release:version)`)
const newest = releases.filter((release) => !release.isDraft && !release.isPrerelease && isVersion(release.tagName))
  .map((release) => normalizeVersion(release.tagName)).sort(compareVersions).at(-1)
if (newest !== undefined && compareVersions(version, newest) <= 0) fail(`${version} is not newer than the published ${newest}`)

console.log(`release:publish: ${tag} to ${repo}${values.prerelease ? ' as a pre-release' : ''}${urgent ? ' (urgent)' : ''}, ${signed ? 'Developer ID signed' : 'unsigned (installs offer the DMG)'}`)
for (const name of files) console.log(`  ${name}`)
console.log(`  notes: ${lines.length} line(s)${values.prerelease ? ', CHANGELOG.md unchanged' : ''}`)
if (dry) process.exit(0)

if (urgent) {
  for (const args of [['typecheck'], ['lint'], ['remote', 'test'], ['test:package']]) {
    console.log(`release:publish: urgent gate: pnpm ${args.join(' ')}`)
    execFileSync('pnpm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, JUNO_E2E_AI_JOBS: '1' } })
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'juno-release-'))
try {
  const notesFile = join(scratch, 'notes.md')
  writeFileSync(notesFile, `${lines.map((line) => `- ${line}`).join('\n')}\n${urgent ? '\n<!-- juno-release: urgent -->\n' : ''}\n<!-- juno-source: ${sourceCommit} -->\n<!-- juno-build: ${buildCommit} -->\n`)
  const uploadStarted = Date.now()
  gh(['release', 'create', tag, '--repo', repo, '--draft', '--title', `Juno ${version}`, '--notes-file', notesFile,
    ...(values.prerelease ? ['--prerelease'] : []), ...files.map((name) => join(dir, name))])
  recordReleaseTiming('upload', uploadStarted, { version, status: urgent ? 'urgent' : 'normal' })
  if (!values.prerelease) {
    const current = JSON.parse(gh(['api', `repos/${repo}/contents/CHANGELOG.md`])) as { content: string; sha: string }
    const next = addChangelogEntry(Buffer.from(current.content, 'base64').toString('utf8'), {
      version,
      date: new Date().toISOString().slice(0, 10),
      lines,
    })
    const body = JSON.stringify({ message: `Juno ${version}`, content: Buffer.from(next).toString('base64'), sha: current.sha })
    gh(['api', '-X', 'PUT', `repos/${repo}/contents/CHANGELOG.md`, '--input', '-'], body)
  }
  gh(['release', 'edit', tag, '--repo', repo, '--draft=false', ...(values.prerelease ? [] : ['--latest'])])
  if (urgent) {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    console.log(`release:publish: no full run covers this urgent release; run pnpm verify:main --ref ${commit} next`)
  }
  console.log(`release:publish: published ${tag}`)
  if (!values.prerelease) syncReleasedVersion(root, version)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
