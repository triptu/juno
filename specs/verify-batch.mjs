// One long-lived Quint process per Apalache lane, for the bounded checks. A fresh
// `quint verify` spent 3 to 13 s before Apalache saw the spec: starting Bun and Quint,
// parsing, typechecking and compiling. This worker parses and typechecks each spec
// file once and compiles every check from a copy of that result, and the compiled
// spec is cached on disk. Either way Apalache receives the same JSON, byte for byte,
// as from `quint verify` (specs/README.md, "Solver bounds"). Apalache's own type
// check (5 to 8 s a check) cannot be shared between requests.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { gunzipSync, gzipSync } from 'node:zlib'

export function verifyBatch(root) {
  let child
  let pending
  const stop = () => {
    if (!child) return
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') } catch { /* Already exited. */ }
    process.removeListener('exit', stop)
    child = undefined
  }
  const finish = (result) => {
    if (!pending) return
    clearTimeout(pending.timer)
    pending.resolve(result)
    pending = undefined
  }
  return {
    stop,
    // `compiled` is the cache file for this check's compiled spec, or undefined.
    run(args, timeout, port, compiled) {
      if (!child) {
        const current = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
          cwd: join(root, 'specs/traces'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32',
        })
        child = current
        process.on('exit', stop)
        // A worker stopped after a timeout must not answer for the next one.
        const own = (handler) => (value) => { if (child === current) handler(value) }
        current.on('message', own(finish))
        current.on('error', own((error) => finish({ status: null, stdout: '', stderr: '', error })))
        let diagnostic = ''
        current.stdout.on('data', (chunk) => { diagnostic += chunk })
        current.stderr.on('data', (chunk) => { diagnostic += chunk })
        current.on('close', own((status) => finish({ status: null, stdout: '', stderr: diagnostic, error: new Error(`Quint verify batch exited with status ${status}`) })))
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          finish({ status: null, stdout: '', stderr: '', error: new Error(`Quint timed out after ${timeout} ms`) })
          // A timed-out check may still hold the lane's server; the next check starts a new worker.
          stop()
        }, timeout)
        pending = { resolve, timer }
        child.send({ args, port, compiled })
      })
    },
  }
}

if (process.argv[2] === '--worker') {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('@informalsystems/quint/package.json')
  if (require(pkg).version !== '0.33.0') throw new Error('Review the verify batch before upgrading Quint')
  const dist = join(dirname(pkg), 'dist/src')
  const commands = require(join(dist, 'cliCommands.js'))
  const apalache = require(join(dist, 'apalache.js'))
  const { outputJson, processApalacheResult } = require(join(dist, 'cliReporting.js'))
  const { newIdGenerator } = require(join(dist, 'idGenerator.js'))
  const checked = new Map()
  const connections = new Map()

  // Parse and typecheck once per file. `compile` adds the check's definitions to the
  // main module, updates the lookup table and analysis maps and draws new IDs, so each
  // check gets its own copy of that data and an ID generator at the same position.
  async function typechecked(args) {
    if (!checked.has(args.input)) {
      let result = await commands.load(args)
      for (const command of ['parse', 'typecheck']) {
        if (result.isLeft()) break
        result = await commands[command](result.value)
      }
      if (result.isLeft()) return result
      const stage = result.value
      checked.set(args.input, {
        stage,
        data: structuredClone({ modules: stage.modules, table: stage.table, types: stage.types, effects: stage.effects, modes: stage.modes }),
        lastId: stage.idGen._lastId,
      })
    }
    const { stage, data, lastId } = checked.get(args.input)
    return commands.compile({ ...stage, ...structuredClone(data), idGen: newIdGenerator(lastId), args })
  }

  // Quint's RPC serialization keeps analysis metadata from every imported module.
  // For agent memory this exceeds Apalache's 20 MB string limit, so for the agent
  // specs keep exactly the types, effects and lookup entries whose IDs occur in the
  // compiled main module. The module and all of its expressions remain unchanged.
  function reduced(compiled) {
    const ids = new Set()
    const collect = (value) => {
      if (!value || typeof value !== 'object') return
      if (typeof value.id === 'bigint') ids.add(value.id)
      for (const child of Object.values(value)) collect(child)
    }
    collect(compiled.mainModule)
    const keep = entries => new Map([...entries].filter(([id]) => ids.has(id)))
    return { ...compiled, types: keep(compiled.types), effects: keep(compiled.effects), table: keep(compiled.table) }
  }

  // The JSON `quint verify` sends to Apalache (verifyWithApalacheBackend in Quint 0.33.0).
  async function compiledSpec(args, file) {
    if (file && existsSync(file)) return { json: gunzipSync(readFileSync(file)).toString() }
    const result = await typechecked(args)
    if (result.isLeft()) return { error: result }
    const compiled = args.input.includes('/agent-') ? reduced(result.value) : result.value
    const json = outputJson({ ...compiled, modules: [compiled.mainModule] })
    if (file) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(`${file}.${process.pid}`, gzipSync(json))
      renameSync(`${file}.${process.pid}`, file)
    }
    return { json }
  }

  process.on('message', async ({ args: argv, port, compiled: file }) => {
    let output = ''
    const stdout = process.stdout.write
    const stderr = process.stderr.write
    const log = console.log
    const errorLog = console.error
    const capture = (chunk, encoding, callback) => {
      output += chunk.toString()
      if (typeof encoding === 'function') encoding()
      else callback?.()
      return true
    }
    process.stdout.write = capture
    process.stderr.write = capture
    // Bun's console writes directly, without going through stream.write.
    console.log = console.error = (...values) => { output += `${format(...values)}\n` }
    let status = 2
    try {
      const args = { input: argv[1], init: 'init', verbosity: 1, hide: [] }
      const strings = { '--main': 'main', '--step': 'step', '--invariant': 'invariant', '--apalache-version': 'apalacheVersion', '--out-itf': 'outItf' }
      const numbers = { '--max-steps': 'maxSteps', '--verbosity': 'verbosity' }
      for (let i = 2; i < argv.length; i++) {
        const flag = argv[i]
        if (strings[flag]) args[strings[flag]] = argv[++i]
        else if (numbers[flag]) args[numbers[flag]] = Number(argv[++i])
        else throw new Error(`Unsupported verify batch argument: ${flag}`)
      }
      args.serverEndpoint = apalache.parseServerEndpoint(`localhost:${port}`).value
      const spec = await compiledSpec(args, file)
      let result = spec.error
      if (!result) {
        if (!connections.has(port)) connections.set(port, await apalache.connect(args.serverEndpoint, args.apalacheVersion, args.verbosity))
        const connection = connections.get(port)
        const startMs = Date.now()
        const response = connection.isLeft() ? connection : await connection.value.check(apalache.createConfig({}, spec.json, args, ['q::inv']))
        result = await processApalacheResult(response, startMs, args.verbosity, { args, stage: 'verifying' }, [args.invariant])
      }
      if (result.isLeft()) {
        console.error(result.value.msg)
        for (const error of result.value.stage?.errors ?? []) console.error(error.message ?? error)
        status = 1
      } else status = 0
    } catch (error) {
      console.error(error.stack ?? error)
    } finally {
      process.stdout.write = stdout
      process.stderr.write = stderr
      console.log = log
      console.error = errorLog
    }
    process.send({ status, stdout: output, stderr: '' })
  })
}
