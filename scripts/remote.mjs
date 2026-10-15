// Runs a root test script on a fresh Namespace Linux machine and streams its output.
//
//   pnpm remote [--dry-run] [--machine linux/amd64:8x16] [--keep] <script> [args...]
//   pnpm remote test
//   pnpm remote specs:check --memory
//
// Every run creates its own machine, so any number of agents can run at once
// with no shared lock (up to the workspace's machine limit). The machine runs
// the image from scripts/remote/Dockerfile, which holds the toolchain and the
// installed dependencies; it is built with `nsc build` the first time the
// lockfile or the Dockerfile changes. The worktree is streamed in as the files
// git sees, tracked or new, with ignored files left out (.env, node_modules,
// out/, test output). Reports come back into .remote/<run>/. The machine is
// destroyed afterwards, also on failure or Ctrl-C, and expires on its own
// after --duration (default 60m) if this process dies.
//
// Needs `nsc` logged in (`nsc login`, or NSC_TOKEN_FILE for a token). See ADR 0013.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Scripts that give the same result on Linux. feel and perf time the Mac and stay local. */
const remoteScripts = ['test', 'specs:check', 'specs:traces', 'test:agent', 'test:agent-contracts', 'test:agent-testing', 'test:gallery', 'gallery:shots', 'test:desktop', 'test:e2e']
const localOnly = { perf: 'timing', 'test:feel': 'timing' }

function parse(argv) {
  const options = { dryRun: false, keep: false, machine: undefined, duration: '60m' }
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
  if (!remoteScripts.includes(script)) throw new Error(`${script} is not set up for remote runs. Remote scripts: ${remoteScripts.join(', ')}`)
  // Spec checks fill 16 cores (Apalache lanes plus simulations); the rest fill 8.
  options.machine ??= script.startsWith('specs:') ? 'linux/amd64:16x32' : 'linux/amd64:8x16'
  return { ...options, script, args }
}

/** Paths that must never leave the Mac, even if someone forgot to ignore them. */
const secretPath = /(^|\/)(\.env(\.(?!example$)[^/]*)?|.*\.(pem|key|p12|keychain-db)|id_(rsa|ed25519)[^/]*|nsc-token[^/]*|token\.json)$/
/** A real Slack token (digits after the prefix) or session cookie in file contents. Test stand-ins like xoxc-fresh-0000 do not match. */
const secretText = /xox[abcdeprs]-\d{6,}-\d{6,}|xoxd-[A-Za-z0-9%]{40,}/

/** The worktree as git sees it, checked for secrets. */
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

/** The image is named by what goes into it: the Dockerfile, the lockfile and the workspace file. */
const imageInputs = ['scripts/remote/Dockerfile', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
function imageTag() {
  const hash = createHash('sha256')
  for (const file of imageInputs) hash.update(file).update('\0').update(readFileSync(join(root, file)))
  return hash.digest('hex').slice(0, 16)
}

const quote = (value) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

/** Runs nsc and returns its stdout; throws with its stderr on failure. */
function nsc(args) {
  const result = spawnSync('nsc', args, { encoding: 'utf8' })
  if (result.error) throw new Error(`nsc is not installed or not on PATH: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`nsc ${args[0]} failed:\n${result.stderr.trim()}`)
  return result.stdout
}

/** About one dial in four to Namespace's gateway times out from the office network; retry calls that are safe to repeat. */
async function retry(what, attempt) {
  for (let tries = 1; ; tries++) {
    try {
      return attempt()
    } catch (error) {
      if (tries === 6) throw error
      console.error(`remote: ${what} failed, retrying (${error.message.split('\n').find((line) => line.startsWith('Failed')) ?? error.message.split('\n')[0]})`)
      await sleep(2000 * tries)
    }
  }
}

/** Builds and pushes the image unless the registry has it. One build at a time per Mac. */
async function ensureImage(registry, tag) {
  const image = `${registry}/juno-remote:${tag}`
  const present = async () => (await retry('listing the registry', () => nsc(['registry', 'list', 'juno-remote', '-o', 'json']))).includes(tag)
  if (await present()) return image
  const lock = join(tmpdir(), 'juno-remote-image.lock')
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch {
      console.error('remote: another worktree is building the image, waiting')
      await sleep(10000)
      if (await present()) return image
    }
  }
  try {
    const context = mkdtempSync(join(tmpdir(), 'juno-remote-image-'))
    const manifests = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*package.json'], { cwd: root, encoding: 'utf8' })
      .stdout.split('\n')
      .filter(Boolean)
    for (const file of [...imageInputs.slice(1), ...manifests, '.npmrc'].filter((name) => existsSync(join(root, name)))) {
      mkdirSync(dirname(join(context, file)), { recursive: true })
      writeFileSync(join(context, file), readFileSync(join(root, file)))
    }
    writeFileSync(join(context, 'Dockerfile'), readFileSync(join(root, 'scripts/remote/Dockerfile')))
    console.error(`remote: building ${image} (the lockfile or Dockerfile changed; a few minutes, once)`)
    const built = spawnSync('nsc', ['build', context, '--name', image, '--push', '--platform', 'linux/amd64'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    rmSync(context, { recursive: true, force: true })
    if (built.status !== 0) throw new Error('nsc build failed')
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
  return image
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
const exitMarker = `__juno_remote_exit_${runId}=`
const scriptArgs = [options.script, ...options.args].map(quote).join(' ')
const container = (image) =>
  `mkdir -p /tmp/out && chmod 777 /tmp/out && s=$(date +%s) && docker pull -q ${image} >/dev/null && echo "remote: image pulled in $(( $(date +%s) - s )) s" >&2 && docker run --rm -i --init --ipc=host -v /tmp/out:/out ${image} ` +
  `bash -c 'tar -xzf - -C /work && exec bash scripts/remote/run.sh "$@"' _ ${scriptArgs}; echo "${exitMarker}$?"`
const create = ['create', '--bare', '--machine_type', options.machine, '--duration', options.duration, '--label', 'juno-remote=1', '--purpose', `juno remote ${options.script}`]

console.error(`remote: ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB before compression), no secrets found`)
if (options.dryRun) {
  console.log('remote: dry run; these steps would run:')
  console.log(`  image nscr.io/<workspace>/juno-remote:${imageTag()} (nsc build --push if the registry lacks it)`)
  console.log(`  nsc ${create.map(quote).join(' ')} --cidfile <tmp>/id`)
  console.log(`  git ls-files ... | tar -czf - --null -T - | nsc ssh -T <id> ${quote(container('<image>'))}`)
  console.log(`  nsc ssh -T <id> 'cat /tmp/out/reports.tgz' | tar -xzf - -C .remote/${runId}`)
  console.log(`  nsc destroy <id> --force${options.keep ? '   (skipped: --keep)' : ''}`)
  process.exit(0)
}

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)} s`
const work = mkdtempSync(join(tmpdir(), 'juno-remote-'))
let id
const cleanup = () => {
  if (id && !options.keep) spawnSync('nsc', ['destroy', id, '--force'], { stdio: 'ignore' })
  id = undefined
  rmSync(work, { recursive: true, force: true })
}
process.on('exit', cleanup)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`remote: ${signal}, destroying the machine`)
    cleanup()
    process.exit(130)
  })
}

let code = 1
try {
  const registry = JSON.parse(await retry('reading the workspace', () => nsc(['workspace', 'describe', '-o', 'json']))).registry_url
  const image = await ensureImage(registry, imageTag())
  const cidfile = join(work, 'id')
  await retry('creating a machine', () => nsc([...create, '--cidfile', cidfile]))
  id = readFileSync(cidfile, 'utf8').trim()
  console.error(`remote: machine ${id} (${options.machine}) after ${elapsed()}; running pnpm ${options.script}`)
  await retry('reaching the machine', () => nsc(['ssh', '-T', id, 'true']))

  const list = join(work, 'files')
  writeFileSync(list, files.join('\0'))
  // A dial that times out before the script starts is retried; once output has
  // arrived the run is not repeated.
  let reported
  for (let tries = 1; reported === undefined; tries++) {
    // COPYFILE_DISABLE stops macOS tar from adding ._ files for extended attributes.
    const tar = spawn('tar', ['-czf', '-', '--no-xattrs', '--null', '-T', list], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const ssh = spawn('nsc', ['ssh', '-T', id, container(image)], { stdio: ['pipe', 'pipe', 'pipe'] })
    ssh.stdin.on('error', () => {})
    tar.stdout.pipe(ssh.stdin)
    let errors = ''
    ssh.stderr.on('data', (chunk) => {
      errors += chunk
      process.stderr.write(chunk)
    })
    const closed = new Promise((resolvePromise) => ssh.on('close', resolvePromise))
    let lines = 0
    for await (const line of createInterface({ input: ssh.stdout })) {
      lines++
      if (line.startsWith(exitMarker)) reported = Number(line.slice(exitMarker.length))
      else console.log(line)
    }
    await closed
    tar.kill()
    if (reported !== undefined) break
    if (lines > 0 || !/dial tcp|i\/o timeout|connection refused/.test(errors) || tries === 6) {
      // nsc ssh turns every failure into 1, so the script's own code comes back as a marker line.
      throw new Error('lost the connection to the machine before the script finished')
    }
    console.error('remote: could not reach the machine, retrying')
    await sleep(2000 * tries)
  }
  code = reported

  const reports = spawnSync('nsc', ['ssh', '-T', id, 'cat /tmp/out/reports.tgz 2>/dev/null'], { maxBuffer: 1024 * 1024 * 1024 })
  if (reports.status === 0 && reports.stdout.length > 0) {
    mkdirSync(reportDir, { recursive: true })
    spawnSync('tar', ['-xzf', '-', '-C', reportDir], { input: reports.stdout })
    console.error(`remote: reports in ${relative(root, reportDir)}/`)
  }
} catch (error) {
  console.error(`remote: ${error.message}`)
  code = 255
} finally {
  if (id && options.keep) console.error(`remote: kept ${id}; nsc ssh ${id} to look around, nsc destroy ${id} when done`)
  cleanup()
}
console.error(`remote: pnpm ${options.script} exited with ${code} after ${elapsed()}`)
process.exit(code)
