// Runs a root test script on a Namespace Linux machine and streams its output.
//
//   pnpm remote [--dry-run] [--machine linux/amd64:16x32] [--keep] [--env KEY=VALUE] <script> [args...]
//   pnpm remote test
//   pnpm remote specs:check --memory
//   pnpm remote --status | --drain
//
// Each run has a machine to itself: a warm one from the pool in
// scripts/remote/pool.mjs, or a new one when none is free, so agents never
// share a lock (the pool caps the total, JUNO_REMOTE_MAX_VCPU). The machine runs
// the image from scripts/remote/Dockerfile, which holds the toolchain and the
// installed dependencies; it is built with `nsc build` the first time the
// lockfile or the Dockerfile changes. The worktree is streamed in as the files
// git sees, tracked or new, with ignored files left out (.env, node_modules,
// out/, test output). Reports come back into .remote/<run>/. After a clean run
// the machine goes back to the pool and is destroyed after 10 idle minutes;
// after a failure or Ctrl-C it is destroyed at once. `--status` lists the pool
// and `--drain` destroys its idle machines.
//
// Needs `nsc` logged in (`nsc login`, or NSC_TOKEN_FILE for a token). See ADR 0013.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { acquire, destroy, forget, reap, release, status } from './remote/pool.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Scripts that give the same result on Linux. feel and perf time the Mac and stay local. */
const remoteScripts = ['test', 'specs:check', 'specs:traces', 'test:agent', 'test:agent-contracts', 'test:agent-testing', 'test:gallery', 'test:desktop', 'test:e2e']
const localOnly = { perf: 'timing', 'test:feel': 'timing', 'gallery:shots': 'the Mac look' }

function parse(argv) {
  const options = { dryRun: false, keep: false, machine: undefined, env: [] }
  let index = 0
  for (; index < argv.length && argv[index].startsWith('--'); index++) {
    const flag = argv[index]
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--keep') options.keep = true
    else if (flag === '--machine') options.machine = argv[++index]
    else if (flag === '--env') options.env.push(argv[++index])
    else throw new Error(`Unknown option ${flag}`)
  }
  const [script, ...args] = argv.slice(index)
  if (!script) throw new Error('usage: pnpm remote [--dry-run] [--machine linux/amd64:8x16] [--keep] <script> [args...]')
  if (localOnly[script]) throw new Error(`${script} measures ${localOnly[script]} and runs only on the Mac. Run pnpm ${script} locally.`)
  if (!remoteScripts.includes(script)) throw new Error(`${script} is not set up for remote runs. Remote scripts: ${remoteScripts.join(', ')}`)
  // One shape for every script, so any warm machine fits any run. Spec checks,
  // the gallery and e2e fill 16 cores; the engine tests use the extra workers.
  options.machine ??= 'linux/amd64:16x32'
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
      await sleep(1000 * tries)
    }
  }
}

/** Builds and pushes the image unless the registry has it. One build at a time per Mac. */
async function ensureImage(registry, tag) {
  const image = `${registry}/juno-remote:${tag}`
  // A tag once seen in the registry stays there; remember it to skip the lookup.
  const seen = join(tmpdir(), 'juno-remote-pool', `image-${tag}`)
  if (existsSync(seen)) return image
  const present = async () => (await retry('listing the registry', () => nsc(['registry', 'list', 'juno-remote', '-o', 'json']))).includes(tag)
  if (await present()) {
    writeFileSync(seen, image)
    return image
  }
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
    writeFileSync(seen, image)
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
  return image
}

const self = fileURLToPath(import.meta.url)
if (process.argv[2] === '--reap') {
  await reap(process.argv[3])
  process.exit(0)
}
if (process.argv[2] === '--status') {
  const pool = status()
  console.log(pool.length === 0 ? 'remote: no machines in the pool' : pool.map((state) => `${state.id} ${state.machine} ${state.busy ? 'busy' : `idle ${Math.round(state.idleFor / 60000)} min`}, up ${Math.round((Date.now() - state.created) / 60000)} min`).join('\n'))
  process.exit(0)
}
if (process.argv[2] === '--drain') {
  for (const state of status()) if (!state.busy) destroy(state.id)
  console.log('remote: idle machines destroyed')
  process.exit(0)
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
  `rm -rf /tmp/out && mkdir -p /tmp/out && chmod 777 /tmp/out && s=$(date +%s) && docker pull -q ${image} >/dev/null && echo "remote: image pulled in $(( $(date +%s) - s )) s" >&2 && docker run --rm -i --init --ipc=host -v /tmp/out:/out ${options.env.map((pair) => `-e ${quote(pair)}`).join(' ')} ${image} ` +
  `bash -c 'tar -xzf - -C /work && exec bash scripts/remote/run.sh "$@"' _ ${scriptArgs}; code=$?; [ -s /tmp/out/reports.tgz ] && echo __juno_remote_reports; echo "${exitMarker}$code"`
const create = (duration) => ['create', '--bare', '--machine_type', options.machine, '--duration', duration, '--label', 'juno-remote=1', '--purpose', 'juno remote']

console.error(`remote: ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB before compression), no secrets found`)
if (options.dryRun) {
  console.log('remote: dry run; these steps would run:')
  console.log(`  image nscr.io/<workspace>/juno-remote:${imageTag()} (nsc build --push if the registry lacks it)`)
  console.log(`  a warm ${options.machine} machine from the pool, or nsc ${create('3h').map(quote).join(' ')} --cidfile <tmp>/id`)
  console.log(`  git ls-files ... | tar -czf - --null -T - | nsc ssh -T <id> ${quote(container('<image>'))}`)
  console.log(`  nsc ssh -T <id> 'cat /tmp/out/reports.tgz' | tar -xzf - -C .remote/${runId}`)
  console.log(`  back to the pool after a clean run (destroyed when idle for 10 minutes), else nsc destroy <id> --force${options.keep ? '   (--keep: left up, outside the pool)' : ''}`)
  process.exit(0)
}

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)} s`
const work = mkdtempSync(join(tmpdir(), 'juno-remote-'))
// Set while this run holds a machine; a run that ends any other way than
// cleanly destroys it, since a container may still be running there.
let id
let image
let clean = false
const cleanup = () => {
  if (id && options.keep) forget(id)
  else if (id && clean) release(id, image, self)
  else if (id) destroy(id)
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
  const registryFile = join(tmpdir(), 'juno-remote-pool', 'registry')
  if (!existsSync(registryFile)) writeFileSync(registryFile, JSON.parse(await retry('reading the workspace', () => nsc(['workspace', 'describe', '-o', 'json']))).registry_url)
  const registry = readFileSync(registryFile, 'utf8')
  image = await ensureImage(registry, imageTag())
  const claimed = await acquire(
    options.machine,
    async (duration) => {
      const cidfile = join(work, 'id')
      await retry('creating a machine', () => nsc([...create(duration), '--cidfile', cidfile]))
      return readFileSync(cidfile, 'utf8').trim()
    },
    (message) => console.error(`remote: ${message}`),
  )
  id = claimed.id
  console.error(`remote: ${claimed.warm ? 'warm' : 'new'} machine ${id} (${options.machine}) after ${elapsed()}; running pnpm ${options.script}`)
  if (!claimed.warm) await retry('reaching the machine', () => nsc(['ssh', '-T', id, 'true']))

  const list = join(work, 'files')
  writeFileSync(list, files.join('\0'))
  // A dial that times out before the script starts is retried; once output has
  // arrived the run is not repeated.
  let reported
  let hasReports = false
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
      else if (line === '__juno_remote_reports') hasReports = true
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
    await sleep(1000 * tries)
  }
  code = reported
  clean = true

  const reports = hasReports ? spawnSync('nsc', ['ssh', '-T', id, 'cat /tmp/out/reports.tgz'], { maxBuffer: 1024 * 1024 * 1024 }) : undefined
  if (reports?.status === 0 && reports.stdout.length > 0) {
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
