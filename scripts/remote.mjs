// Runs a root test script on a Namespace Linux machine and streams its output.
//
//   pnpm remote [--dry-run] [--machine linux/amd64:4x8] [--keep] [--env KEY=VALUE] <script> [args...]
//   pnpm remote test
//   pnpm remote specs:check --memory
//   pnpm remote test:plan test + test:desktop   several scripts on one machine (scripts/plan.mjs)
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
//
// When Namespace stops answering, a waiting run says so and keeps waiting;
// JUNO_REMOTE_OUTAGE_WAIT=10m makes it give up after that much outage with
// exit code 75 (docs/development.md, "Remote runs", "Outages").

import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { runnerConfig, checkRunner, runnerCommand } from './remote/runner.mjs'
import { imageTag, ensureImage, nsc, retry, quote, sleep } from './remote/image.mjs'
import { runShards } from './remote/shards.mjs'
import { acquire, destroy, idleMinutes, keep, reap, release, status } from './remote/pool.mjs'
import { outage } from './remote/outage.mjs'
import { describeOutage, outageExit } from './remote/pool-decisions.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const started = Date.now()

/** Scripts that give the same result on Linux. feel and perf time the Mac and stay local. */
const remoteScripts = ['bench:engine', 'bench:sync', 'lint', 'test', 'specs:check', 'specs:traces', 'specs:conformance', 'test:agent', 'test:agent-contracts', 'test:agent-testing', 'test:gallery', 'test:desktop', 'test:e2e', 'test:plan', 'test:remote-pool']
// Every script uses one shape, so a free machine fits any waiting run and warm
// machines are reused. Measurements: docs/development.md, "Machine shapes".
const standardShape = '8x16'
const localOnly = { perf: 'timing', 'test:feel': 'timing', 'gallery:shots': 'the Mac look' }

function parse(argv) {
  const options = { dryRun: false, keep: false, fresh: false, machine: undefined, env: [] }
  let index = 0
  for (; index < argv.length && argv[index].startsWith('--'); index++) {
    const flag = argv[index]
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--fresh') options.fresh = true
    else if (flag === '--keep') options.keep = true
    else if (flag === '--machine') options.machine = argv[++index]
    else if (flag === '--env') options.env.push(argv[++index])
    else throw new Error(`Unknown option ${flag}`)
  }
  const [script, ...args] = argv.slice(index)
  if (!script) throw new Error('usage: pnpm remote [--dry-run] [--machine linux/amd64:8x16] [--keep] <script> [args...]')
  if (localOnly[script]) throw new Error(`${script} measures ${localOnly[script]} and runs only on the Mac. Run pnpm ${script} locally.`)
  if (!remoteScripts.includes(script)) throw new Error(`${script} is not set up for remote runs. Remote scripts: ${remoteScripts.join(', ')}`)
  options.explicitMachine = Boolean(options.machine ?? process.env.JUNO_REMOTE_MACHINE)
  options.machine ??= process.env.JUNO_REMOTE_MACHINE ?? `linux/amd64:${standardShape}`
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

const self = fileURLToPath(import.meta.url)
if (process.argv[2] === '--reap') {
  await reap(process.argv[3])
  process.exit(0)
}
if (process.argv[2] === '--status') {
  const pool = status()
  const active = outage()
  if (active) console.log(`remote: ${describeOutage(active)}`)
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
const withoutShards = process.argv.slice(2).filter((_, index) => shardsAt < 0 || (index !== shardsAt - 2 && index !== shardsAt - 1))
const combined = parse(withoutShards)
if (combined.script === 'test:e2e' && combined.args.length) throw new Error('Select files with test:desktop or test:gallery')
if (shardsAt > 1) {
  const total = Number(process.argv[shardsAt + 1])
  const rest = process.argv.slice(2).filter((_, index) => index !== shardsAt - 2 && index !== shardsAt - 1)
  const parsed = parse(rest)
  const desktop = parsed.script === 'test:desktop' && !parsed.args.some((arg) => arg.startsWith('--repeat-each'))
  process.exit(await runShards({ total, rest, self, root, desktop, dryRun: parsed.dryRun }))
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
const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${process.pid}-${randomUUID().slice(0, 8)}`

// Spec checks, alone or in a plan, take the Mac's cache of passing results
// along (staged in the ignored .remote/ folder) and bring back what they add.
const carried = { 'specs:': { name: 'specs', env: 'SPECS_CACHE_DIR' } }
const carry = Object.entries(carried).find(([prefix]) => options.script.startsWith(prefix) || (options.script === 'test:plan' && options.args.some((arg) => arg.startsWith(prefix))))?.[1]
const specCache = carry && join(tmpdir(), 'juno-cache', carry.name)
const stagedCache = carry && `.remote/cache-${runId}/${carry.name}`
const carriesCache = carry !== undefined && process.env.SPECS_CACHE !== 'off' && !options.args.includes('--no-cache') && !options.args.includes('SPECS_CACHE=off')
if (carriesCache && !options.dryRun) {
  mkdirSync(join(root, stagedCache), { recursive: true })
  if (existsSync(specCache)) cpSync(specCache, join(root, stagedCache), { recursive: true })
  for (const name of readdirSync(join(root, stagedCache))) files.push(`${stagedCache}/${name}`)
  options.env.push(`${carry.env}=/work/${stagedCache}`)
}
const reportDir = join(root, '.remote', runId)
const exitMarker = `__juno_remote_exit_${runId}=`
const scriptArgs = [options.script, ...options.args].map(quote).join(' ')
const outputDir = `/tmp/juno-remote-${runId}`
let backend = 'namespace'
let runner
let cores = Number(/:(\d+)x/.exec(options.machine)?.[1])
const transport = (command) => backend === 'ssh' ? ['ssh', [...runner.args, command]] : ['nsc', ['ssh', '-T', id, command]]
const container = (image) =>
  `echo __juno_remote_started; rm -rf ${outputDir} && mkdir -p ${outputDir} && chmod 777 ${outputDir} && s=$(date +%s) && ${backend === 'ssh' ? `docker image inspect ${image} >/dev/null` : `docker pull -q ${image} >/dev/null`} && echo "remote: image pulled in $(( $(date +%s) - s )) s" >&2 && echo __juno_remote_ready && docker run --name juno-${runId} --rm -i --init --ipc=host ${backend === 'ssh' ? `--cpus ${cores} -e JUNO_RUNNER_JOB_CORES=${cores}` : ''} -v ${outputDir}:/out ${options.env.map((pair) => `-e ${quote(pair)}`).join(' ')} ${image} ` +
  `bash -c 'tar -xzf - -C /work && exec bash scripts/remote/run.sh "$@"' _ ${scriptArgs}; code=$?; [ -s ${outputDir}/reports.tgz ] && echo __juno_remote_reports; echo "${exitMarker}$code"`
const create = (duration) => ['create', '--bare', '--machine_type', options.machine, '--duration', duration, '--label', 'juno-remote=1', '--purpose', 'juno remote', ...(process.env.JUNO_REMOTE_IMAGE_CACHE === 'on' ? ['--experimental', JSON.stringify({ container_cache: { tag: 'juno-remote-images-v1', size_mb: 8192 } })] : [])]

console.error(`remote: ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB before compression), no secrets found`)
if (options.dryRun) {
  console.log('remote: dry run; these steps would run:')
  if (process.env.JUNO_RUNNER_HOST) console.log('  try the configured SSH runner first; Namespace steps apply only if unreachable')
  console.log(`  image nscr.io/<workspace>/juno-remote:${imageTag()} (nsc build --push if the registry lacks it)`)
  console.log(`  a warm ${options.machine} machine from the pool, or nsc ${create('3h').map(quote).join(' ')} --cidfile <tmp>/id`)
  console.log(`  git ls-files ... | tar -czf - --null -T - | nsc ssh -T <id> ${quote(container('<image>'))}`)
  console.log(`  nsc ssh -T <id> 'cat ${outputDir}/reports.tgz' | tar -xzf - -C .remote/${runId}`)
  console.log(`  back to the pool after a clean run (destroyed when idle for ${idleMinutes} minutes), else nsc destroy <id> --force${options.keep ? '   (--keep: tracked until its 3-hour expiry)' : ''}`)
  process.exit(0)
}

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
let startupSeconds
let warm
let machineSeconds
let activeSsh
let activeTar
const cleanup = () => {
  if (backend === 'ssh' && id) {
    const [command, args] = transport(`docker rm -f juno-${runId} >/dev/null 2>&1; rm -rf ${outputDir}`)
    spawnSync(command, args, { stdio: 'ignore', timeout: 15_000 })
  } else if (id && options.keep) keep(id)
  else if (id && clean) release(id, image)
  else if (id) destroy(id)
  if (id && acquiredAt && (backend !== 'ssh' || machineSeconds === undefined)) machineSeconds = (Date.now() - acquiredAt) / 1000
  id = undefined
  rmSync(work, { recursive: true, force: true })
  rmSync(join(root, '.remote', `cache-${runId}`), { recursive: true, force: true })
}
process.on('exit', (exitCode) => { cleanup(); finishLog(exitCode) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`remote: ${signal}, stopping the remote run`)
    activeSsh?.kill(signal)
    activeTar?.kill(signal)
    cleanup()
    finishLog(130)
    console.error(`remote: output in ${relative(root, runLog)}`)
    process.exit(130)
  })
}

let code = 1
let infraFailure = false
let outageFailure = false
let finalized = false
function finishLog(result) {
  if (finalized) return
  finalized = true
  appendFileSync(runLog, `remote: exited with ${result}\nremote: summary ${JSON.stringify({ code: result, infraFailure, outage: outageFailure, backend, warm, readySeconds, startupSeconds, machineSeconds, wallSeconds: (Date.now() - started) / 1000 })}\n`)
}
try {
  runner = runnerConfig()
  if (runner) {
    const health = checkRunner(runner)
    if (health.reachable) {
      backend = 'ssh'
      if (options.keep) throw new Error('--keep is only available for Namespace')
      // The standard shape is a Namespace size; a smaller runner runs the job on what it has.
      if (cores > health.cores && !options.explicitMachine) cores = health.cores
      if (cores > health.cores) throw new Error(`job needs ${cores} cores; runner has ${health.cores}`)
      if (!runner.image) throw new Error('Set JUNO_RUNNER_IMAGE to the preloaded Juno image; pnpm runner:check verifies it')
    } else console.error(`remote: runner unreachable, trying Namespace: ${health.reason}`)
  }
  if (backend === 'namespace' && Number(process.env.JUNO_REMOTE_MAX_VCPU ?? 48) === 0) throw new Error('Namespace is disabled (JUNO_REMOTE_MAX_VCPU=0) and no runner is reachable')
  appendFileSync(runLog, `remote: backend ${backend}\n`)
  if (backend === 'ssh') {
    image = runner.image
    id = runner.host
    acquiredAt = Date.now()
  } else {
  const registryFile = join(tmpdir(), 'juno-remote-pool', 'registry')
  if (!existsSync(registryFile)) writeFileSync(registryFile, JSON.parse(await retry('reading the workspace', () => nsc(['workspace', 'describe', '-o', 'json']))).registry_url)
  const registry = readFileSync(registryFile, 'utf8')
  image = await ensureImage(registry, imageTag())
  const claimed = await acquire(
    options.machine,
    async (duration, labels) => {
      const cidfile = join(work, 'id')
      acquiredAt = Date.now()
      rmSync(cidfile, { force: true })
      // A create normally takes about 20 s; a hung one is ended and reconciled by its label.
      try { nsc([...create(duration), ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), '--cidfile', cidfile], { timeout: 10 * 60_000 }) } catch (error) {
        if (existsSync(cidfile)) error.instanceId = readFileSync(cidfile, 'utf8').trim()
        throw error
      }
      return readFileSync(cidfile, 'utf8').trim()
    },
    (message) => { console.error(`remote: ${message}`); appendFileSync(runLog, `remote: ${message}\n`) },
    { fresh: options.fresh },
  )
  id = claimed.id
  acquiredAt ??= Date.now()
  warm = claimed.warm
  appendFileSync(runLog, `remote: machine ${JSON.stringify({ id, warm, acquiredSeconds: (Date.now() - started) / 1000 })}\n`)
  console.error(`remote: ${claimed.warm ? 'warm' : 'new'} machine ${id} (${options.machine}) after ${elapsed()}; running pnpm ${options.script}`)

  }

  const list = join(work, 'files')
  writeFileSync(list, files.join('\0'))
  // A dial that times out before the script starts is retried; once output has
  // arrived the run is not repeated.
  let reported
  let hasReports = false
  for (let tries = 1; reported === undefined; tries++) {
    // COPYFILE_DISABLE stops macOS tar from adding ._ files for extended attributes.
    const tar = spawn('tar', ['-czf', '-', '--no-xattrs', '--null', '-T', list], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const remoteCommand = backend === 'ssh' ? runnerCommand(cores, runId, container(image)) : container(image)
    const [executable, remoteArgs] = transport(remoteCommand)
    const ssh = spawn(executable, remoteArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    activeSsh = ssh
    activeTar = tar
    ssh.on('close', () => { activeSsh = undefined; activeTar = undefined })
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
    let commandStarted = false
    const dialTimer = setTimeout(() => {
      if (!commandStarted && backend !== 'ssh') {
        errors += 'dial tcp: no start line within 8 s'
        ssh.kill()
      }
    }, 8000)
    let lines = 0
    for await (const line of createInterface({ input: ssh.stdout })) {
      if (line === '__juno_remote_released') { machineSeconds = (Date.now() - acquiredAt) / 1000; continue }
      if (line === '__juno_remote_allocated') { acquiredAt = Date.now(); continue }
      if (line === '__juno_remote_ready') {
        startupSeconds = (Date.now() - acquiredAt) / 1000
        readySeconds = (Date.now() - started) / 1000
        console.error(`remote: image ready after ${readySeconds.toFixed(1)} s`)
        continue
      }
      if (line === '__juno_remote_started') {
        commandStarted = true
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
    if (backend === 'ssh' || commandStarted || lines > 0 || !/dial tcp|i\/o timeout|connection refused/.test(errors) || tries === 6) {
      // nsc ssh turns every failure into 1, so the script's own code comes back as a marker line.
      throw new Error('lost the connection to the machine before the script finished')
    }
    console.error('remote: could not reach the machine, retrying')
    await sleep(1000 * tries)
  }
  code = reported
  clean = code === 0
  console.error(`remote: script done after ${elapsed()}`)

  const reportTransport = transport(`cat ${outputDir}/reports.tgz`)
  const reports = hasReports ? await retry('downloading reports', () => {
    const result = spawnSync(reportTransport[0], reportTransport[1], { maxBuffer: 1024 * 1024 * 1024 })
    if (result.status !== 0) throw new Error('could not download remote reports')
    return result
  }) : undefined
  if (reports?.status === 0 && reports.stdout.length > 0) {
    mkdirSync(reportDir, { recursive: true })
    const unpacked = spawnSync('tar', ['-xzf', '-', '-C', reportDir], { input: reports.stdout })
    if (unpacked.status !== 0) throw new Error('could not unpack remote reports')
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
  infraFailure = true
  // A run that gave up on a Namespace outage (JUNO_REMOTE_OUTAGE_WAIT) exits 75, so callers can run it locally instead.
  outageFailure = Boolean(error.outage)
  code = outageFailure ? outageExit : 255
  clean = false
} finally {
  if (backend === 'namespace' && id && options.keep) console.error(`remote: kept ${id}; nsc ssh ${id} to look around, nsc destroy ${id} when done`)
  cleanup()
}
console.error(`remote: pnpm ${options.script} exited with ${code} after ${elapsed()}`)
finishLog(code)
console.error(`remote: output in ${relative(root, runLog)}`)
process.exit(code)
