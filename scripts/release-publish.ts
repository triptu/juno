#!/usr/bin/env bun
/**
 * Publishes a built release to the private releases repository (docs/development.md,
 * "Releasing"). Run with `bun run release:publish --notes <file>` after `bun run package`.
 *
 * It uses `gh` with the local login; no token is read, printed or written here.
 * Steps: check the build in apps/desktop/release matches the version in
 * apps/desktop/package.json and carries the updater's config, check the version is
 * newer than every published release, create a draft release `v<version>` with the
 * DMG, block map and latest-mac.yml (also ZIP for signed builds), add the notes to CHANGELOG.md, then
 * publish the draft. The app only sees a release once it is published.
 *
 * Flags:
 *   --notes <file>   the highlights of this version, one per line, at most ten (required to publish)
 *   --stage         validate and upload a draft only; never publishes or changes main
 *   --discard-draft delete only a staged draft from this exact build
 *   --urgent         publish after typecheck, lint, unit tests and package smoke; start bun run verify:main for it next
 *   --prerelease     publish as a pre-release: the app never offers it, and CHANGELOG.md is left alone
 *   --dry-run        check everything and print the plan; change nothing
 *   --dir <path>     the build folder (default apps/desktop/release)
 *   --repo <o/r>     the releases repository (default triptu/juno-releases)
 */
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { addChangelogEntry, compareVersions, isVersion, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'
import { releaseGate, printGate } from './release-gate.mjs'
import { highlightLines } from './release-highlights.mjs'
import { checkPublishedRelease, syncReleasedVersion } from './release-main.mjs'
import { scratchFolder } from './worktree-folder.mjs'
import { recordReleaseTiming } from './release-timings.mjs'

const scriptRoot = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    notes: { type: 'string' },
    checkout: { type: 'string', default: scriptRoot },
    source: { type: 'string' },
    urgent: { type: 'boolean', default: false },
    stage: { type: 'boolean', default: false },
    'discard-draft': { type: 'boolean', default: false },
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
if ((values.stage || values['discard-draft']) && (urgent || values.prerelease)) fail('draft staging cannot be urgent or a pre-release')
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
const releases = JSON.parse(gh(['release', 'list', '--repo', repo, '--limit', '200', '--json', 'tagName,isDraft,isPrerelease'])) as Array<{ tagName: string; isDraft: boolean; isPrerelease: boolean }>
const published = releases.find((release) => release.tagName === tag && !release.isDraft && !release.isPrerelease)
if (published && (values.stage || values['discard-draft'])) fail(`${tag} is already published; refusing to change it as a draft`)
if (published && !values.prerelease) {
  if (!dry) {
    measured('release validation', () => checkPublishedRelease(repo, version))
    measured('main version sync', () => syncReleasedVersion(root, version))
  }
  console.log(`release:publish: ${tag} is already published; only the main version update was needed`)
  process.exit(0)
}
// Only drafts created by this exact build can be resumed or deleted.
const existing = releases.find((release) => release.tagName === tag)
const draft = existing?.isDraft ? JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'body,assets'])) as { body: string; assets: Array<{ name: string; size: number }> } : undefined
if (existing && (!draft || !draft.body.includes(`<!-- juno-build: ${buildCommit} -->`)
  || !draft.body.includes('<!-- juno-staged -->'))) fail(`${repo} already has ${tag}; refusing to change another release`)
if (values['discard-draft']) {
  if (draft && !dry) measured('discard draft', () => gh(['release', 'delete', tag, '--repo', repo, '--yes']))
  process.exit(0)
}
let lines: readonly string[] = []
if (!values.stage) {
  if (values.notes === undefined) fail('--notes <file> is required: the highlights of this version')
  try {
    lines = highlightLines(readFileSync(values.notes, 'utf8'))
  } catch (error) {
    fail(`${values.notes}: ${(error as Error).message}`)
  }
}

// The build.
if (!existsSync(join(dir, 'latest-mac.yml'))) fail(`no latest-mac.yml in ${dir}; run bun run package first`)
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
if (!signed && files.some((name) => name.endsWith('.zip'))) fail('an unsigned build must not upload a ZIP; rebuild with bun run package')

if (!urgent) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) fail('commit or remove working-tree changes before publishing')
  if (!values.stage) {
    const gate = releaseGate(root, commit)
    if (!gate) fail('no eligible full-run record for this commit; inspect bun run verify:main results')
    printGate(gate)
  }
}

if (draft && (draft.assets.length !== files.length || files.some((name) => !draft.assets.some((asset) => asset.name === name && asset.size === statSync(join(dir, name)).size)))) fail(`${tag} has incomplete or mismatched draft assets; discard the draft and stage it again`)
const newest = releases.filter((release) => !release.isDraft && !release.isPrerelease && isVersion(release.tagName))
  .map((release) => normalizeVersion(release.tagName)).toSorted(compareVersions).at(-1)
if (newest !== undefined && compareVersions(version, newest) <= 0) fail(`${version} is not newer than the published ${newest}`)

console.log(`release:publish: ${tag} to ${repo}${values.stage ? ' as a draft only' : values.prerelease ? ' as a pre-release' : ''}${urgent ? ' (urgent)' : ''}, ${signed ? 'Developer ID signed' : 'unsigned (installs offer the DMG)'}`)
for (const name of files) console.log(`  ${name}`)
console.log(`  notes: ${lines.length} line(s)${values.prerelease ? ', CHANGELOG.md unchanged' : ''}`)
if (dry) process.exit(0)

if (urgent) {
  for (const args of [['typecheck'], ['lint'], ['remote', 'test'], ['test:package']]) {
    console.log(`release:publish: urgent gate: bun run ${args.join(' ')}`)
    execFileSync('bun', ['run', ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, JUNO_E2E_AI_JOBS: '1' } })
  }
}

const scratch = mkdtempSync(join(scratchFolder(), 'juno-release-'))
try {
  const notesFile = join(scratch, 'notes.md')
  writeFileSync(notesFile, `${lines.map((line) => `- ${line}`).join('\n')}\n${urgent ? '\n<!-- juno-release: urgent -->\n' : ''}\n<!-- juno-source: ${sourceCommit} -->\n<!-- juno-build: ${buildCommit} -->\n<!-- juno-staged -->\n`)
  if (!draft) {
    // gh uploads all assets concurrently, with five workers (including signed ZIPs).
    measured('upload', () => gh(['release', 'create', tag, '--repo', repo, '--draft', '--title', `Juno ${version}`, '--notes-file', notesFile,
      ...(values.prerelease ? ['--prerelease'] : []), ...files.map((name) => join(dir, name))]))
  }
  if (values.stage) {
    console.log(`release:publish: staged ${tag}; still a draft, not latest`)
    process.exitCode = 0
  } else {
    if (!values.prerelease) {
      measured('changelog', () => {
        const current = JSON.parse(gh(['api', `repos/${repo}/contents/CHANGELOG.md`])) as { content: string; sha: string }
        const next = addChangelogEntry(Buffer.from(current.content, 'base64').toString('utf8'), {
          version,
          date: new Date().toISOString().slice(0, 10),
          lines,
        })
        const body = JSON.stringify({ message: `Juno ${version}`, content: Buffer.from(next).toString('base64'), sha: current.sha })
        gh(['api', '-X', 'PUT', `repos/${repo}/contents/CHANGELOG.md`, '--input', '-'], body)
      })
    }
    measured('mark published', () => gh(['release', 'edit', tag, '--repo', repo, '--notes-file', notesFile, '--draft=false', ...(values.prerelease ? [] : ['--latest'])]))
    if (urgent) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
      console.log(`release:publish: no full run covers this urgent release; run bun run verify:main --ref ${commit} next`)
    }
    console.log(`release:publish: published ${tag}`)
    if (!values.prerelease) {
      measured('release validation', () => checkPublishedRelease(repo, version))
      measured('main version sync', () => syncReleasedVersion(root, version))
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

function measured<T>(step: string, work: () => T): T {
  const started = Date.now()
  let status = 'failed'
  try {
    const result = work()
    status = 'passed'
    return result
  } finally {
    recordReleaseTiming(step, started, { version, status }, root)
  }
}
