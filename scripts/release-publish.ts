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
 *   --notes <file>   the changelog lines for this version, one per line (required)
 *   --urgent         publish after typecheck, lint, unit tests and package smoke; request an immediate full keeper run
 *   --prerelease     publish as a pre-release: the app never offers it, and CHANGELOG.md is left alone
 *   --dry-run        check everything and print the plan; change nothing
 *   --dir <path>     the build folder (default apps/desktop/release)
 *   --repo <o/r>     the releases repository (default triptu/juno-releases)
 */
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { addChangelogEntry, compareVersions, isVersion, normalizeVersion, parseChangelog } from '../apps/desktop/src/main/releaseNotes.ts'
import { recordReleaseTiming } from './release-timings.mjs'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    notes: { type: 'string' },
    urgent: { type: 'boolean', default: false },
    prerelease: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    dir: { type: 'string', default: join(root, 'apps/desktop/release') },
    repo: { type: 'string', default: 'triptu/juno-releases' },
  },
})
const dry = values['dry-run']
const repo = values.repo
const dir = resolve(values.dir)
const urgent = values.urgent

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
if (values.notes === undefined) fail('--notes <file> is required: the changelog lines for this version')
const lines = parseChangelog(`## ${version}\n${readFileSync(values.notes, 'utf8')}`)[0]?.lines ?? []
if (lines.length === 0) fail(`${values.notes} has no lines`)

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

const sharedStatus = resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim(), '../.juno-status')
if (!urgent) {
  const summaryFile = join(sharedStatus, 'verify-main.json')
  if (!existsSync(summaryFile)) fail('no CI keeper full-suite result; use --urgent only for a problem hurting the owner now')
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8')) as { commit?: string; passed?: boolean }
  if (!summary.passed || !summary.commit) fail('the latest CI keeper full-suite run is not green')
  const changed = execFileSync('git', ['diff', '--name-only', summary.commit, '--'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  if (changed.some((name) => name !== 'apps/desktop/package.json')) fail(`changes since the green commit are not limited to the version bump: ${changed.join(', ')}`)
  const greenPackage = JSON.parse(execFileSync('git', ['show', `${summary.commit}:apps/desktop/package.json`], { cwd: root, encoding: 'utf8' })) as Record<string, unknown>
  const currentPackage = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')) as Record<string, unknown>
  if (JSON.stringify({ ...greenPackage, version }) !== JSON.stringify(currentPackage)) fail('the app package differs from the green commit beyond its version')
}

// The repository.
gh(['auth', 'status'])
const releases = JSON.parse(gh(['release', 'list', '--repo', repo, '--limit', '200', '--json', 'tagName,isDraft,isPrerelease'])) as Array<{ tagName: string; isDraft: boolean; isPrerelease: boolean }>
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
    execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' })
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'juno-release-'))
try {
  const notesFile = join(scratch, 'notes.md')
  writeFileSync(notesFile, `${lines.map((line) => `- ${line}`).join('\n')}\n${urgent ? '\n<!-- juno-release: urgent -->\n' : ''}`)
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
    mkdirSync(sharedStatus, { recursive: true })
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    writeFileSync(join(sharedStatus, 'ci-keeper-request.json'), `${JSON.stringify({ kind: 'urgent-release-full-suite', tag, commit, requestedAt: new Date().toISOString(), command: `pnpm verify:main --ref ${commit}` }, null, 2)}\n`)
    console.log(`release:publish: CI keeper request written; run pnpm verify:main --ref ${commit} now`)
  }
  console.log(`release:publish: published ${tag}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
