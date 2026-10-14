// Runs a root test script on a fresh Namespace Linux machine and streams its output.
//
//   pnpm remote [--dry-run] [--machine linux/amd64:8x16] [--keep] <script> [args...]
//   pnpm remote --dry-run specs:check
//
// Every run creates its own machine, so any number of agents can run at once
// with no shared lock (up to the account's machine limit). The machine gets a
// snapshot of this worktree: the files git sees, tracked or new, with ignored
// files left out (.env, node_modules, out/, test output). It installs the
// toolchain, runs `pnpm <script>`, copies the reports back into
// .remote/<run>/ and is destroyed, also when the run fails.
//
// Needs the `nsc` CLI and NSC_TOKEN_FILE set to a Namespace token file kept
// outside the repo (see docs/decisions/0013-remote-test-runs.md).
// --dry-run checks the snapshot and prints the commands without nsc or a token.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Scripts that give the same result on Linux. feel, perf and shots measure or show the Mac and stay local. */
const remoteScripts = {
  test: { reports: [] },
  'specs:check': { reports: ['specs/traces'] },
  'specs:traces': { reports: ['specs/traces'] },
  'test:agent': { reports: [] },
  'test:agent-contracts': { reports: [] },
  'test:agent-testing': { reports: [] },
  'test:gallery': { reports: ['apps/gallery/test-results', 'apps/gallery/playwright-report'] },
  'test:e2e': { reports: ['apps/desktop/test-results', 'apps/gallery/test-results', 'apps/gallery/playwright-report'] },
}
const localOnly = { perf: 'timing', 'test:feel': 'timing', 'gallery:shots': 'the Mac look' }

function parse(argv) {
  const options = { dryRun: false, keep: false, machine: 'linux/amd64:8x16', duration: '45m' }
  let index = 0
  for (; index < argv.length && argv[index].startsWith('--'); index++) {
    const flag = argv[index]
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--keep') options.keep = true
    else if (flag === '--machine') options.machine = argv[++index]
    else if (flag === '--duration') options.duration = argv[++index]
    else throw new Error(`Unknown option ${flag}`)
  }
  const [script, ...args] = argv.slice(index)
  if (!script) throw new Error('usage: pnpm remote [--dry-run] [--machine linux/amd64:8x16] [--keep] <script> [args...]')
  if (localOnly[script]) throw new Error(`${script} measures ${localOnly[script]} and runs only on the Mac. Run pnpm ${script} locally.`)
  if (!remoteScripts[script]) throw new Error(`${script} is not set up for remote runs. Remote scripts: ${Object.keys(remoteScripts).join(', ')}`)
  return { ...options, script, args }
}

/** Paths that must never leave the Mac, even if someone forgot to ignore them. */
const secretPath = /(^|\/)(\.env(\.(?!example$)[^/]*)?|.*\.(pem|key|p12|keychain-db)|id_(rsa|ed25519)[^/]*|nsc-token[^/]*|token\.json)$/
/** A real Slack token (digits after the prefix) or session cookie in file contents. Test stand-ins like xoxc-fresh-0000 do not match. */
const secretText = /xox[abcdeprs]-\d{6,}-\d{6,}|xoxd-[A-Za-z0-9%]{40,}/

/** The worktree as git sees it, checked for secrets. Returns the file list. */
function snapshot() {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  // Design images and prototypes under docs/ are not test inputs and are most of the bytes.
  const files = listed.stdout
    .split('\0')
    .filter((file) => file && !(file.startsWith('docs/') && !file.endsWith('.md')) && existsSync(join(root, file)) && statSync(join(root, file)).isFile())
  const problems = []
  let bytes = 0
  for (const file of files) {
    if (secretPath.test(file)) problems.push(`${file}: looks like a secret file`)
    const size = statSync(join(root, file)).size
    bytes += size
    if (size < 4 * 1024 * 1024 && secretText.test(readFileSync(join(root, file), 'latin1'))) problems.push(`${file}: contains what looks like a Slack token`)
  }
  if (problems.length > 0) throw new Error(`Not sending this worktree:\n  ${problems.join('\n  ')}`)
  return { files, bytes }
}

const quote = (value) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)

function run(command, args, { input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] })
    if (input) input.pipe(child.stdin)
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code: code ?? 1 }))
  })
}

let options
let snapshotted
try {
  options = parse(process.argv.slice(2))
  snapshotted = snapshot()
} catch (error) {
  console.error(`remote: ${error.message}`)
  process.exit(2)
}
const { files, bytes } = snapshotted
const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${process.pid}`
const reportDir = join(root, '.remote', runId)
const remoteCommand = `cd /work && bash scripts/remote/setup.sh && bash scripts/remote/run.sh ${[options.script, ...options.args].map(quote).join(' ')}`
const reports = remoteScripts[options.script].reports
const work = mkdtempSync(join(tmpdir(), 'juno-remote-'))
const cidfile = join(work, 'id')
const create = ['create', '--machine_type', options.machine, '--duration', options.duration, '--bare', '--volume', 'cache:juno-toolchain:/cache:30gb', '--cidfile', cidfile]

console.log(`remote: ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB before compression), no secrets found`)
if (options.dryRun) {
  console.log('remote: dry run; these commands would run:')
  console.log(`  nsc ${create.map(quote).join(' ')}`)
  console.log(`  git ls-files -z --cached --others --exclude-standard | tar -czf - --null -T - | nsc ssh -T <id> 'rm -rf /work && mkdir -p /work && tar -xzf - -C /work'`)
  console.log(`  nsc ssh -T <id> ${quote(remoteCommand)}`)
  if (reports.length > 0) console.log(`  nsc ssh -T <id> 'cd /work && tar -czf - --ignore-failed-read ${reports.join(' ')}' | tar -xzf - -C .remote/${runId}`)
  console.log(`  nsc destroy <id> --force${options.keep ? '   (skipped: --keep)' : ''}`)
  rmSync(work, { recursive: true, force: true })
  process.exit(0)
}

if (spawnSync('nsc', ['--help'], { stdio: 'ignore' }).error) throw new Error('nsc is not installed: brew install namespacelabs/namespace/nsc')
const tokenFile = process.env.NSC_TOKEN_FILE
if (!tokenFile || !existsSync(tokenFile)) throw new Error('Set NSC_TOKEN_FILE to a Namespace token file (docs/decisions/0013-remote-test-runs.md).')
if (!relative(root, resolve(tokenFile)).startsWith('..')) throw new Error('Keep the Namespace token file outside the repo.')

if ((await run('nsc', create)).code !== 0) throw new Error('nsc create failed. A ResourceLimitsError means the account is running its maximum number of machines.')
const id = readFileSync(cidfile, 'utf8').trim()
console.log(`remote: machine ${id} (${options.machine})`)

let code = 1
try {
  const list = join(work, 'files')
  writeFileSync(list, files.join('\0'))
  const tar = spawn('tar', ['-czf', '-', '--null', '-T', list], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
  const uploaded = await run('nsc', ['ssh', '-T', id, 'rm -rf /work && mkdir -p /work && tar -xzf - -C /work'], { input: tar.stdout })
  if (uploaded.code !== 0) throw new Error('Copying the worktree to the machine failed')
  code = (await run('nsc', ['ssh', '-T', id, remoteCommand])).code
  if (reports.length > 0) {
    mkdirSync(reportDir, { recursive: true })
    const fetch = spawn('nsc', ['ssh', '-T', id, `cd /work && tar -czf - --ignore-failed-read ${reports.join(' ')}`], { stdio: ['ignore', 'pipe', 'inherit'] })
    await run('tar', ['-xzf', '-', '-C', reportDir], { input: fetch.stdout })
    console.log(`remote: reports in ${relative(root, reportDir)}/`)
  }
} finally {
  if (options.keep) console.log(`remote: kept ${id}; nsc ssh ${id} to look around, nsc destroy ${id} when done`)
  else await run('nsc', ['destroy', id, '--force'])
  rmSync(work, { recursive: true, force: true })
}
console.log(`remote: pnpm ${options.script} exited with ${code}`)
process.exit(code)
