// Runs a root test script on a Namespace Linux machine and streams its output.
//
//   pnpm remote [--dry-run] [--machine linux/amd64:4x8] [--keep] [--env KEY=VALUE] <script> [args...]
//   pnpm remote test
//   pnpm remote specs:check --memory
//   pnpm remote --shards 2 specs:check     one script split across machines
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
// the machine goes back to the pool and is destroyed after the configured idle window;
// after a failure or Ctrl-C it is destroyed at once. `--status` lists the pool
// and `--drain` destroys its idle machines.
//
// Needs `nsc` logged in (`nsc login`, or NSC_TOKEN_FILE for a token). See ADR 0013.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { forwardSignals } from './remote/children.mjs'
import { acquire, destroy, keep, reap, release, status } from './remote/pool.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Scripts that give the same result on Linux. feel and perf time the Mac and stay local. */
const remoteScripts = ['typecheck', 'lint', 'test', 'specs:check', 'specs:traces', 'test:agent', 'test:agent-contracts', 'test:agent-testing', 'test:gallery', 'test:desktop', 'test:e2e']
/**
 * The smallest shape that keeps each script within about three minutes,
 * measured on 2026-10-15 (docs/development.md, "Machine shapes"). Namespace bills
 * vCPU-minutes, so a bigger machine only pays when the script keeps it busy.
 */
const remoteShapes = {
  typecheck: '2x4',
  lint: '2x4',
  test: '4x8',
  'test:agent': '2x4',
  'test:agent-contracts': '2x4',
  'test:agent-testing': '2x4',
  'test:gallery': '4x8',
  'test:desktop': '8x16',
  'test:e2e': '8x16',
  'specs:check': '8x16',
  'specs:traces': '8x16',
}
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
  options.machine ??= process.env.JUNO_REMOTE_MACHINE ?? `linux/amd64:${remoteShapes[script] ?? '4x8'}`
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
  console.log(pool.length === 0 ? 'remote: no machines in the pool' : pool.map((state) => `${state.id} ${state.machine} ${state.destroying ? 'destroying (retry pending)' : state.kept ? 'kept until expiry' : state.busy ? 'busy' : `idle ${Math.round(state.idleFor / 60000)} min`}, up ${Math.round((Date.now() - state.created) / 60000)} min`).join('\n'))
  process.exit(0)
}
if (process.argv[2] === '--drain') {
  const results = status().filter((state) => !state.busy && !state.kept).map((state) => destroy(state.id))
  console.log(results.every(Boolean) ? 'remote: idle machines destroyed' : 'remote: some destroys failed; retained for retry')
  process.exit(results.every(Boolean) ? 0 : 1)
}

// --shards n runs the script on n machines at once, each with JUNO_SHARD=i/n
// (0-based), and fails if any shard fails. specs:check honours JUNO_SHARD.
const shardsAt = process.argv.indexOf('--shards')
if (shardsAt > 1 && process.argv.slice(2, shardsAt).every((arg) => arg.startsWith('--'))) {
  const total = Number(process.argv[shardsAt + 1])
  const rest = process.argv.slice(2).filter((_, index) => index !== shardsAt - 2 && index !== shardsAt - 1)
  const children = new Set()
  forwardSignals(children)
  const runs = Array.from({ length: total }, (_, index) =>
    new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [self, '--env', `JUNO_SHARD=${index}/${total}`, ...rest], { stdio: ['ignore', 'pipe', 'pipe'] })
      children.add(child)
      child.on('close', () => children.delete(child))
      for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => console.log(`[${index + 1}/${total}] ${line}`))
      child.on('close', (code) => resolvePromise(code ?? 1))
    }),
  )
  const codes = await Promise.all(runs)
  console.error(`remote: shards exited with ${codes.join(', ')}`)
  process.exit(Math.max(...codes))
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

// Spec checks and typechecks take the Mac's cache of passing results along
// (staged in the ignored .remote/ folder) and bring back what they add, so a
// check that passed anywhere is not run again.
const carried = { 'specs:': { name: 'specs', env: 'SPECS_CACHE_DIR' }, typecheck: { name: 'typecheck', env: 'JUNO_TYPECHECK_CACHE_DIR' } }
const carry = Object.entries(carried).find(([prefix]) => options.script.startsWith(prefix))?.[1]
const specCache = carry && join(tmpdir(), 'juno-cache', carry.name)
const stagedCache = carry && `.remote/cache-${runId}/${carry.name}`
const carriesCache = carry !== undefined && process.env.SPECS_CACHE !== 'off' && !options.args.includes('--no-cache')
if (carriesCache && !options.dryRun) {
  mkdirSync(join(root, stagedCache), { recursive: true })
  if (existsSync(specCache)) cpSync(specCache, join(root, stagedCache), { recursive: true })
  for (const name of readdirSync(join(root, stagedCache))) files.push(`${stagedCache}/${name}`)
  options.env.push(`${carry.env}=/work/${stagedCache}`)
}
const reportDir = join(root, '.remote', runId)
const exitMarker = `__juno_remote_exit_${runId}=`
const scriptArgs = [options.script, ...options.args].map(quote).join(' ')
const container = (image) =>
  `echo __juno_remote_started; rm -rf /tmp/out && mkdir -p /tmp/out && chmod 777 /tmp/out && s=$(date +%s) && docker pull -q ${image} >/dev/null && echo "remote: image pulled in $(( $(date +%s) - s )) s" >&2 && echo __juno_remote_ready && docker run --rm -i --init --ipc=host -v /tmp/out:/out ${options.env.map((pair) => `-e ${quote(pair)}`).join(' ')} ${image} ` +
  `bash -c 'tar -xzf - -C /work && exec bash scripts/remote/run.sh "$@"' _ ${scriptArgs}; code=$?; [ -s /tmp/out/reports.tgz ] && echo __juno_remote_reports; echo "${exitMarker}$code"`
const create = (duration) => ['create', '--bare', '--machine_type', options.machine, '--duration', duration, '--label', 'juno-remote=1', '--purpose', 'juno remote', ...(process.env.JUNO_REMOTE_IMAGE_CACHE === 'off' ? [] : ['--volume', 'cache:juno-remote-docker-v1:/var/lib/docker:16GB'])]

console.error(`remote: ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB before compression), no secrets found`)
if (options.dryRun) {
  console.log('remote: dry run; these steps would run:')
  console.log(`  image nscr.io/<workspace>/juno-remote:${imageTag()} (nsc build --push if the registry lacks it)`)
  console.log(`  a warm ${options.machine} machine from the pool, or nsc ${create('3h').map(quote).join(' ')} --cidfile <tmp>/id`)
  console.log(`  git ls-files ... | tar -czf - --null -T - | nsc ssh -T <id> ${quote(container('<image>'))}`)
  console.log(`  nsc ssh -T <id> 'cat /tmp/out/reports.tgz' | tar -xzf - -C .remote/${runId}`)
  console.log(`  back to the pool after a clean run (destroyed when idle for 5 minutes), else nsc destroy <id> --force${options.keep ? '   (--keep: tracked until its 3-hour expiry)' : ''}`)
  process.exit(0)
}

const started = Date.now()
mkdirSync(reportDir, { recursive: true })
const runLog = join(reportDir, 'run.log')
writeFileSync(runLog, `pnpm ${scriptArgs}\nremote: run ${JSON.stringify({ version: 1, script: options.script, args: options.args, machine: options.machine, started: new Date(started).toISOString() })}\n`)
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)} s`
const work = mkdtempSync(join(tmpdir(), 'juno-remote-'))
// Set while this run holds a machine; a run that ends any other way than
// cleanly destroys it, since a container may still be running there.
let id
let image
let clean = false
let acquiredAt
let readySeconds
let warm
let machineSeconds
const cleanup = () => {
  if (id && options.keep) keep(id)
  else if (id && clean) release(id, image)
  else if (id) destroy(id)
  if (acquiredAt) machineSeconds = (Date.now() - acquiredAt) / 1000
  id = undefined
  rmSync(work, { recursive: true, force: true })
  rmSync(join(root, '.remote', `cache-${runId}`), { recursive: true, force: true })
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
    async (duration, labels) => {
      const cidfile = join(work, 'id')
      nsc([...create(duration), ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), '--cidfile', cidfile])
      return readFileSync(cidfile, 'utf8').trim()
    },
    (message) => { console.error(`remote: ${message}`); appendFileSync(runLog, `remote: ${message}\n`) },
  )
  id = claimed.id
  acquiredAt = Date.now()
  warm = claimed.warm
  console.error(`remote: ${claimed.warm ? 'warm' : 'new'} machine ${id} (${options.machine}) after ${elapsed()}; running pnpm ${options.script}`)

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
      appendFileSync(runLog, chunk)
      process.stderr.write(chunk)
    })
    const closed = new Promise((resolvePromise) => ssh.on('close', resolvePromise))
    // A dial that fails takes nsc about 16 s to give up on; one that works
    // prints the start line within about 4 s. Give up after 8 s and dial again.
    let started = false
    const dialTimer = setTimeout(() => {
      if (!started) {
        errors += 'dial tcp: no start line within 8 s'
        ssh.kill()
      }
    }, 8000)
    let lines = 0
    for await (const line of createInterface({ input: ssh.stdout })) {
      if (line === '__juno_remote_ready') {
        readySeconds = (Date.now() - started) / 1000
        console.error(`remote: image ready after ${readySeconds.toFixed(1)} s`)
        continue
      }
      if (line === '__juno_remote_started') {
        started = true
        clearTimeout(dialTimer)
        continue
      }
      if (lines === 0) console.error(`remote: first output after ${elapsed()}`)
      lines++
      if (line.startsWith(exitMarker)) reported = Number(line.slice(exitMarker.length))
      else if (line === '__juno_remote_reports') hasReports = true
      else {
        appendFileSync(runLog, `${line}\n`)
        console.log(line)
      }
    }
    await closed
    clearTimeout(dialTimer)
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
  clean = code === 0
  console.error(`remote: script done after ${elapsed()}`)

  const reports = hasReports ? spawnSync('nsc', ['ssh', '-T', id, 'cat /tmp/out/reports.tgz'], { maxBuffer: 1024 * 1024 * 1024 }) : undefined
  if (reports?.status === 0 && reports.stdout.length > 0) {
    mkdirSync(reportDir, { recursive: true })
    spawnSync('tar', ['-xzf', '-', '-C', reportDir], { input: reports.stdout })
    const returned = carriesCache ? join(reportDir, stagedCache) : undefined
    if (returned && existsSync(returned)) {
      mkdirSync(specCache, { recursive: true })
      const before = existsSync(specCache) ? readdirSync(specCache).length : 0
      cpSync(returned, specCache, { recursive: true, force: false })
      console.error(`remote: ${carry.name} cache ${before} -> ${readdirSync(specCache).length} entries`)
      rmSync(join(reportDir, '.remote'), { recursive: true, force: true })
    }
    console.error(`remote: reports in ${relative(root, reportDir)}/`)
  }
} catch (error) {
  appendFileSync(runLog, `remote: ${error.message}\n`)
  console.error(`remote: ${error.message}`)
  code = 255
} finally {
  if (id && options.keep) console.error(`remote: kept ${id}; nsc ssh ${id} to look around, nsc destroy ${id} when done`)
  cleanup()
}
console.error(`remote: pnpm ${options.script} exited with ${code} after ${elapsed()}`)
appendFileSync(runLog, `remote: exited with ${code}\nremote: summary ${JSON.stringify({ code, warm, readySeconds, machineSeconds, wallSeconds: (Date.now() - started) / 1000 })}\n`)
console.error(`remote: output in ${relative(root, runLog)}`)
process.exit(code)
