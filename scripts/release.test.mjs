// The release command end to end, against a fake GitHub (a `gh` on PATH), a
// fake full run (verify:main writing records) and a fake package step, in a
// throwaway repository with its own origin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scratchFolder } from './worktree-folder.mjs'

const script = join(import.meta.dirname, 'release.mjs')
const publishScript = join(import.meta.dirname, 'release-publish.ts')
const app = 'apps/desktop/package.json'

// GitHub: releases and CHANGELOG.md in a JSON file; every call is logged.
const fakeGh = (state, calls) => `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(calls)}, args.join(' ') + '\\n')
const state = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'))
const save = () => fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(state))
const pick = (release, fields) => Object.fromEntries(fields.split(',').map((field) => [field, release[field]]))
const json = (args) => args[args.indexOf('--json') + 1]
const find = (tag) => state.releases.find((release) => release.tagName === tag)
const [group, command, tag] = args
if (group === 'auth') process.exit(0)
if (group === 'release' && command === 'list') console.log(JSON.stringify(state.releases.map((release) => pick(release, json(args)))))
else if (group === 'release' && command === 'view') { if (!find(tag)) process.exit(1); console.log(JSON.stringify(pick(find(tag), json(args)))) }
else if (group === 'release' && command === 'create') {
  const valued = ['--repo', '--title', '--notes-file']
  const files = args.slice(3).filter((arg, i, rest) => !arg.startsWith('--') && !valued.includes(rest[i - 1]))
  state.releases.push({ tagName: tag, isDraft: true, isPrerelease: args.includes('--prerelease'), isLatest: false, publishedAt: '',
    body: fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8'), assets: files.map((file) => ({ name: file.split('/').pop() })) })
  save()
} else if (group === 'release' && command === 'edit') {
  for (const release of state.releases) release.isLatest = args.includes('--latest') ? release.tagName === tag : release.isLatest
  Object.assign(find(tag), { isDraft: false, publishedAt: new Date().toISOString() })
  save()
} else if (group === 'api' && !args.includes('PUT')) console.log(JSON.stringify({ sha: 'one', content: Buffer.from(state.changelog).toString('base64') }))
else if (group === 'api') { state.changelog = Buffer.from(JSON.parse(fs.readFileSync(0, 'utf8')).content, 'base64').toString('utf8'); save() }
else process.exit(99)
`

// The laptop's full run: takes the next outcome from a plan file and writes the record verify:main would.
const fakeVerify = (plan, calls) => `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, args.join(' ') + '\\n')
const [outcome, ...rest] = readFileSync(${JSON.stringify(plan)}, 'utf8').split('\\n').filter(Boolean)
writeFileSync(${JSON.stringify(plan)}, rest.join('\\n'))
const commit = execFileSync('git', ['rev-parse', args[args.indexOf('--ref') + 1]], { encoding: 'utf8' }).trim()
const repair = args.includes('--repair') ? JSON.parse(readFileSync(args[args.indexOf('--repair') + 1], 'utf8')) : undefined
const required = ['test', 'specs:check', 'specs:conformance', 'test:gallery', 'test:desktop']
const red = outcome === 'red'
if (args.includes('--nightly')) writeFileSync('apps/desktop/e2e/coverage-map.json', JSON.stringify({ version: 1, commit, specs: [], files: {} }))
const finishedAt = new Date().toISOString()
const record = { version: 2, commit, finishedAt, passed: !red, identity: { bun: '1', platform: 'linux', arch: 'x64', electron: '44' }, required,
  repair: repair && { commit: repair.commit, finishedAt: repair.finishedAt, selection: 'graph-uncapped' },
  suites: required.map((suite) => red && suite === 'test:desktop'
    ? { suite, code: 1, failures: ['1) sidebar.spec.ts:40 › keeps the selected row'], log: '.juno-status/verify-main/run/test_desktop.log', cause: { category: 'test', provisional: true, evidence: 'timed out waiting for the row' } }
    : { suite, code: 0, failures: [] }) }
const folder = '.juno-status/verify-main/commits/' + commit
mkdirSync(folder, { recursive: true })
writeFileSync(folder + '/' + finishedAt.replace(/\\W/g, '') + '.json', JSON.stringify(record))
process.exit(red ? 1 : 0)
`

// bun run package: the files electron-builder writes for the checkout's version.
const fakePackage = `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const version = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')).version
const dmg = 'Juno-' + version + '-arm64.dmg'
mkdirSync('apps/desktop/release', { recursive: true })
writeFileSync('apps/desktop/release/' + dmg, 'dmg')
writeFileSync('apps/desktop/release/' + dmg + '.blockmap', 'map')
writeFileSync('apps/desktop/release/latest-mac.yml', 'version: ' + version + '\\nfiles:\\n  - url: ' + dmg + '\\npath: ' + dmg + '\\n')
`

function fixture(t) {
  mkdirSync(scratchFolder(), { recursive: true })
  const folder = mkdtempSync(join(scratchFolder(), 'release-test-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const repo = join(folder, 'repo')
  const remote = join(folder, 'remote.git')
  const bin = join(folder, 'bin')
  const file = (name) => join(folder, name)
  for (const path of [repo, bin, file('home'), file('tmp')]) mkdirSync(path)
  const env = { ...process.env, HOME: file('home'), TMPDIR: file('tmp'), TMP: file('tmp'), TEMP: file('tmp'), JUNO_RELEASE: '', PATH: `${bin}:${process.env.PATH}`, JUNO_WORKTREE_DIR: file('worktrees'), JUNO_UPDATE_TOKEN: 'fake',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim()
  const commit = (subject, files) => {
    for (const [name, text] of Object.entries(files)) { mkdirSync(join(repo, name, '..'), { recursive: true }); writeFileSync(join(repo, name), text) }
    git('add', '.')
    git('commit', '-qm', subject)
    git('push', '-q', 'origin', 'HEAD:main')
    return git('rev-parse', 'HEAD')
  }
  writeFileSync(file('gh-state.json'), JSON.stringify({ releases: [], changelog: '# Changelog\n\n## 0.1.8 - 2026-10-20\n\n- Peek shows the last reply.\n' }))
  writeFileSync(file('plan'), '')
  writeFileSync(join(bin, 'gh'), fakeGh(file('gh-state.json'), file('gh-calls')))
  chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(file('verify.mjs'), fakeVerify(file('plan'), file('verify-calls')))
  writeFileSync(file('package.mjs'), fakePackage)
  execFileSync('git', ['init', '-q', '--bare', remote], { env })
  git('init', '-q', '-b', 'main')
  git('remote', 'add', 'origin', remote)
  const scripts = { 'verify:main': `bun ${file('verify.mjs')}`, package: `bun ${file('package.mjs')}`, 'test:package': 'true' }
  const source = commit('Release 0.1.8', {
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts }, null, 2),
    '.gitignore': 'node_modules\n.juno-status\napps/desktop/release\n',
    [app]: '{\n  "version": "0.1.8",\n  "main": "app.js"\n}\n',
    'apps/desktop/src/app.js': 'first',
    'apps/desktop/e2e/coverage-map.json': '{}',
  })
  const github = () => JSON.parse(readFileSync(file('gh-state.json'), 'utf8'))
  const state = github()
  state.releases.push({ tagName: 'v0.1.8', isDraft: false, isPrerelease: false, isLatest: true, publishedAt: '2026-10-20T10:00:00Z', body: `- Peek shows the last reply.\n<!-- juno-source: ${source} -->\n`, assets: [] })
  writeFileSync(file('gh-state.json'), JSON.stringify(state))
  const lines = (name) => existsSync(file(name)) ? readFileSync(file(name), 'utf8').split('\n').filter(Boolean) : []
  /** Runs the real command; `onOutput` sees the output so far and may answer it, as the agent does. */
  const release = (args = [], onOutput = () => {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--repo', 'triptu/fixture', '--notes-timeout', '0.1', ...args], { cwd: repo, env, timeout: 25_000 })
    let output = ''
    const read = (chunk) => { output += chunk; onOutput(output) }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('exit', (_code, signal) => { if (signal !== null) console.error(`Release fixture stopped by ${signal}:\n${output}`) })
    child.on('close', (code) => resolve({ code, output }))
  })
  return { folder, repo, remote, env, git, commit, release, github, lines, plan: (...outcomes) => writeFileSync(file('plan'), outcomes.join('\n')), file }
}

test('a red full run stops with its failures; after a fix, the same command repairs, waits for highlights and publishes', { timeout: 60_000 }, async (t) => {
  const { git, commit, release, github, lines, plan, file } = fixture(t)
  commit('Add tests for sidebar selection', { 'apps/desktop/src/sidebar.test.ts': 'test' })
  const tip = commit('Keep your place after scrolling', { 'apps/desktop/src/app.js': 'scroll' })

  const looked = await release(['--dry-run'])
  assert.equal(looked.code, 0, looked.output)
  assert.match(looked.output, /releasing 0\.1\.9/)
  assert.match(looked.output, /\n {2}Keep your place after scrolling\n/)
  assert.doesNotMatch(looked.output, /Add tests/)
  assert.match(looked.output, new RegExp(`would run bun run verify:main --ref ${tip} --require-remote on the laptop`))
  assert.deepEqual(lines('verify-calls'), [])

  plan('red')
  const red = await release()
  assert.equal(red.code, 1, red.output)
  assert.match(red.output, /test:desktop: failed \(1\), cause test \(provisional\): timed out waiting for the row/)
  assert.match(red.output, /1\) sidebar\.spec\.ts:40 › keeps the selected row/)
  const repairCommand = /bun run verify:main --ref origin\/main --repair (\S+\.json)/.exec(red.output)
  assert.ok(repairCommand, red.output)
  assert.match(red.output, /nothing was built or published/)

  // Rerunning without a fix would only hope for green, so it refuses.
  const unchanged = await release()
  assert.equal(unchanged.code, 1)
  assert.match(unchanged.output, /main has not changed since; fix the failures first/)
  assert.equal(lines('verify-calls').length, 1)

  commit('Fix the selected row after scrolling', { 'apps/desktop/src/app.js': 'scroll, fixed' })
  plan('green')
  let wrote = 0
  const green = await release([], (output) => {
    // The agent writes the highlights while the full run goes; the first draft has a commit hash.
    if (wrote === 0 && output.includes('waiting for the highlights at')) {
      wrote = 1
      writeFileSync(/waiting for the highlights at (\S+)/.exec(output)[1], '- Fixed a crash (5162affc5).\n')
    } else if (wrote === 1 && output.includes('waiting for a corrected file')) {
      wrote = 2
      writeFileSync(/waiting for the highlights at (\S+)/.exec(output)[1], '- Keep your place after scrolling.\n- The selected row stays selected.\n')
    }
  })
  assert.equal(green.code, 0, green.output)
  assert.match(lines('verify-calls')[1], new RegExp(`--repair ${repairCommand[1]}`))
  assert.match(green.output, /checked v0\.1\.9: Juno-0\.1\.9-arm64\.dmg, Juno-0\.1\.9-arm64\.dmg\.blockmap, latest-mac\.yml; marked latest/)

  const published = github().releases.find((entry) => entry.tagName === 'v0.1.9')
  assert.equal(published.isDraft, false)
  assert.equal(published.isLatest, true)
  assert.match(published.body, new RegExp(`juno-source: ${git('rev-parse', 'origin/main^')}`))
  assert.match(github().changelog, /## 0\.1\.9 - \d{4}-\d\d-\d\d\n\n- Keep your place after scrolling\.\n- The selected row stays selected\.\n\n## 0\.1\.8/)
  git('fetch', '-q', 'origin')
  assert.equal(git('log', '-1', '--format=%s', 'origin/main'), 'Set version to 0.1.9 after release')
  assert.deepEqual(JSON.parse(git('show', `origin/main:${app}`)), { version: '0.1.9', main: 'app.js' })
  assert.equal(existsSync(file('worktrees/release-0.1.9')), false)
  const steps = JSON.parse(readFileSync(join(file('repo'), '.juno-status/release-timings.json'), 'utf8')).steps.map((step) => step.step)
  for (const step of ['full run', 'highlights wait', 'prepare', 'package', 'package-smoke', 'upload', 'publish', 'cleanup']) assert.ok(steps.includes(step), step)

  const again = await release()
  assert.equal(again.code, 0, again.output)
  assert.match(again.output, /no action: no user-facing changes since the last release/)
  assert.doesNotMatch(lines('gh-calls').join('\n'), /create v0\.1\.10/)
})

test('a release covered by an earlier green run plus docs skips the full run; a lost main update is finished without publishing again', { timeout: 30_000 }, async (t) => {
  const { git, commit, release, github, lines, plan, remote, file, env } = fixture(t)
  const verified = commit('Keep your place after scrolling', { 'apps/desktop/src/app.js': 'scroll' })
  plan('green')
  // A green run for an earlier commit covers a tip with only docs after it.
  execFileSync('bun', ['run', 'verify:main', '--ref', verified], { cwd: file('repo'), env: env })
  commit('Describe scrolling', { 'docs/scrolling.md': 'docs' })
  const covered = await release(['--dry-run'])
  assert.match(covered.output, new RegExp(`covered by full run ${verified}`))

  // Publishing works, but main refuses the version commit.
  const hook = join(remote, 'hooks/pre-receive')
  writeFileSync(hook, '#!/bin/sh\nexit 1\n')
  chmodSync(hook, 0o755)
  writeFileSync(join(file('repo'), 'notes.md'), '- Keep your place after scrolling.\n')
  const failed = await release(['--notes', 'notes.md'])
  assert.equal(failed.code, 1)
  assert.match(failed.output, /Release 0\.1\.9 is published, but updating origin\/main failed/)
  assert.equal(lines('verify-calls').length, 1)
  assert.equal(github().releases.find((entry) => entry.tagName === 'v0.1.9').isDraft, false)

  rmSync(hook)
  // A partial upload must not advance main, even on the recovery path.
  const state = github()
  const releaseEntry = state.releases.find((entry) => entry.tagName === 'v0.1.9')
  const assets = releaseEntry.assets
  releaseEntry.assets = assets.filter((asset) => !asset.name.endsWith('.blockmap'))
  writeFileSync(file('gh-state.json'), JSON.stringify(state))
  const incomplete = await release(['--notes', 'notes.md'])
  assert.equal(incomplete.code, 1, incomplete.output)
  assert.match(incomplete.output, /no matching DMG block map/)
  assert.equal(JSON.parse(git('show', `origin/main:${app}`)).version, '0.1.8')
  releaseEntry.assets = assets
  writeFileSync(file('gh-state.json'), JSON.stringify(state))
  const finished = await release(['--notes', 'notes.md'])
  assert.equal(finished.code, 0, finished.output)
  assert.match(finished.output, /restored v0\.1\.9 on origin\/main; no publish needed/)
  git('fetch', '-q', 'origin')
  assert.equal(JSON.parse(git('show', `origin/main:${app}`)).version, '0.1.9')
  assert.equal(lines('gh-calls').filter((call) => call.startsWith('release create')).length, 1)
  // release:publish, rerun by hand, also only finishes main.
  const publish = execFileSync(process.execPath, [publishScript, '--checkout', file('worktrees/release-0.1.9'), '--repo', 'triptu/fixture'], { cwd: file('repo'), env: env, encoding: 'utf8' })
  assert.match(publish, /already published/)
})

test('the version commit lands on a newer main, keeping concurrent work and every other field', (t) => {
  const { folder, remote, git, commit, env } = fixture(t)
  commit('Newer work', { [app]: '{\n  "version": "0.1.8",\n  "main": "other.js"\n}\n', 'apps/desktop/src/new.js': 'new' })
  const racer = join(folder, 'racer')
  execFileSync('git', ['clone', '-q', '-b', 'main', remote, racer], { env })
  writeFileSync(join(racer, 'race.js'), 'concurrent work')
  execFileSync('git', ['add', '.'], { cwd: racer, env })
  execFileSync('git', ['commit', '-qm', 'Concurrent work'], { cwd: racer, env })
  // The racer pushes between our fetch and our push.
  const hook = join(folder, 'repo/.git/hooks/pre-push')
  writeFileSync(hook, `#!/bin/sh\nrm "$0"\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\ngit -C '${racer}' push -q origin main\n`)
  chmodSync(hook, 0o755)
  const sync = (version) => execFileSync(process.execPath, ['-e', `import('${join(import.meta.dirname, 'release-main.mjs')}').then((m) => console.log(m.syncReleasedVersion(process.cwd(), '${version}')))`], { cwd: join(folder, 'repo'), env, encoding: 'utf8' }).trim()
  assert.equal(sync('0.1.9'), 'true')
  git('fetch', '-q', 'origin')
  assert.equal(git('log', '--format=%s', '-3', 'origin/main'), 'Set version to 0.1.9 after release\nConcurrent work\nNewer work')
  assert.deepEqual(JSON.parse(git('show', `origin/main:${app}`)), { version: '0.1.9', main: 'other.js' })
  assert.equal(git('diff', '--name-only', 'origin/main^', 'origin/main'), app)
  assert.equal(sync('v0.1.9'), 'false')
  assert.equal(sync('0.1.8'), 'false')
})


test('nightly coverage survives a red run and is pushed after repair without changing the caller checkout', { timeout: 30_000 }, async (t) => {
  const { commit, release, plan, file, git, lines } = fixture(t)
  const source = commit('Keep scrolling smooth', { 'apps/desktop/src/app.js': 'scroll' })
  plan('red')
  const red = await release(['--nightly'])
  assert.equal(red.code, 1, red.output)
  assert.equal(readFileSync(file('repo/apps/desktop/e2e/coverage-map.json'), 'utf8'), '{}')
  assert.equal(JSON.parse(readFileSync(file('repo/.juno-status/release-coverage.json'), 'utf8')).source, source)
  commit('Fix scrolling', { 'apps/desktop/src/app.js': 'fixed' })
  plan('green')
  writeFileSync(file('notes.md'), '- Keep scrolling smooth.\n')
  const green = await release(['--notes', file('notes.md')])
  assert.equal(green.code, 0, green.output)
  assert.ok(lines('verify-calls').every((line) => line.includes('--require-remote')))
  git('fetch', '-q', 'origin')
  assert.equal(JSON.parse(git('show', 'origin/main:apps/desktop/e2e/coverage-map.json')).commit, source)
  assert.equal(existsSync(file('repo/.juno-status/release-coverage.json')), false)
  assert.equal(readFileSync(file('repo/apps/desktop/e2e/coverage-map.json'), 'utf8'), '{}')
})
