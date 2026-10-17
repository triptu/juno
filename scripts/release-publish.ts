#!/usr/bin/env node
/**
 * Publishes a built release to the private releases repository (docs/development.md,
 * "Releasing"). Run with `pnpm release:publish -- --notes <file>` after `pnpm package`.
 *
 * It uses `gh` with the local login; no token is read, printed or written here.
 * Steps: check the build in apps/desktop/release matches the version in
 * apps/desktop/package.json and carries the updater's config, check the version is
 * newer than every published release, create a draft release `v<version>` with the
 * DMG, ZIP, block maps and latest-mac.yml, add the notes to CHANGELOG.md, then
 * publish the draft. The app only sees a release once it is published.
 *
 * Flags:
 *   --notes <file>   the changelog lines for this version, one per line (required)
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
import { addChangelogEntry, compareVersions, isVersion, normalizeVersion, parseChangelog } from '../apps/desktop/src/main/releaseNotes.ts'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    notes: { type: 'string' },
    prerelease: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    dir: { type: 'string', default: join(root, 'apps/desktop/release') },
    repo: { type: 'string', default: 'triptu/juno-releases' },
  },
})
const dry = values['dry-run']
const repo = values.repo
const dir = resolve(values.dir)

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
for (const url of metadata.matchAll(/^\s*-?\s*url:\s*(\S+)/gm)) if (!files.includes(url[1]!)) fail(`latest-mac.yml names ${url[1]}, which is not in ${dir}`)
if (!files.some((name) => name.endsWith('.dmg'))) fail(`no DMG for ${version} in ${dir}`)

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

// The repository.
gh(['auth', 'status'])
const releases = JSON.parse(gh(['release', 'list', '--repo', repo, '--limit', '200', '--json', 'tagName,isDraft,isPrerelease'])) as Array<{ tagName: string; isDraft: boolean; isPrerelease: boolean }>
if (releases.some((release) => release.tagName === tag)) fail(`${repo} already has ${tag}; bump the version (pnpm release:version)`)
const newest = releases.filter((release) => !release.isDraft && !release.isPrerelease && isVersion(release.tagName))
  .map((release) => normalizeVersion(release.tagName)).sort(compareVersions).at(-1)
if (newest !== undefined && compareVersions(version, newest) <= 0) fail(`${version} is not newer than the published ${newest}`)

console.log(`release:publish: ${tag} to ${repo}${values.prerelease ? ' as a pre-release' : ''}, ${signed ? 'Developer ID signed' : 'unsigned (installs offer the DMG)'}`)
for (const name of files) console.log(`  ${name}`)
console.log(`  notes: ${lines.length} line(s)${values.prerelease ? ', CHANGELOG.md unchanged' : ''}`)
if (dry) process.exit(0)

const scratch = mkdtempSync(join(tmpdir(), 'juno-release-'))
try {
  const notesFile = join(scratch, 'notes.md')
  writeFileSync(notesFile, `${lines.map((line) => `- ${line}`).join('\n')}\n`)
  gh(['release', 'create', tag, '--repo', repo, '--draft', '--title', `Juno ${version}`, '--notes-file', notesFile,
    ...(values.prerelease ? ['--prerelease'] : []), ...files.map((name) => join(dir, name))])
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
  console.log(`release:publish: published ${tag}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
