// Quint 0.33's CLI pipeline, with one parse/typecheck per input file. Each call
// still creates a fresh evaluator and RNG and uses Quint's own ITF writer.
import { spawn } from 'node:child_process'
import { setPriority } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'

export function simulationBatch(root, { niceness = 0 } = {}) {
  let child
  let pending
  const stop = () => {
    if (!child) return
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') } catch { /* Already exited. */ }
    process.removeListener('exit', stop)
  }
  const finish = (result) => {
    if (!pending) return
    clearTimeout(pending.timer)
    pending.resolve(result)
    pending = undefined
  }
  return {
    stop,
    run(args, timeout) {
      if (!child) {
        child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
          cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32',
        })
        process.on('exit', stop)
        if (niceness > 0) setPriority(child.pid, niceness)
        child.on('message', finish)
        child.on('error', (error) => finish({ status: null, stdout: '', stderr: '', error }))
        let diagnostic = ''
        child.stdout.on('data', (chunk) => { diagnostic += chunk })
        child.stderr.on('data', (chunk) => { diagnostic += chunk })
        child.on('close', (status) => finish({ status: null, stdout: '', stderr: diagnostic, error: new Error(`Quint batch exited with status ${status}`) }))
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          finish({ status: null, stdout: '', stderr: '', error: new Error(`Quint timed out after ${timeout} ms`) })
          stop()
        }, timeout)
        pending = { resolve, timer }
        child.send(args)
      })
    },
  }
}

if (process.argv[2] === '--worker') {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('@informalsystems/quint/package.json')
  if (require(pkg).version !== '0.33.0') throw new Error('Review the batch adapter before upgrading Quint')
  const commands = require(join(dirname(pkg), 'dist/src/cliCommands.js'))
  let checked
  process.on('message', async (argv) => {
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
      const args = { input: argv[1], init: 'init', nTraces: 1, witnesses: [], invariants: [], hide: [] }
      const strings = { '--main': 'main', '--init': 'init', '--step': 'step', '--invariant': 'invariant', '--backend': 'backend', '--out-itf': 'outItf' }
      const numbers = { '--n-threads': 'nThreads', '--max-samples': 'maxSamples', '--max-steps': 'maxSteps', '--verbosity': 'verbosity' }
      for (let i = 2; i < argv.length; i++) {
        const flag = argv[i]
        if (strings[flag]) args[strings[flag]] = argv[++i]
        else if (numbers[flag]) args[numbers[flag]] = Number(argv[++i])
        else if (flag === '--seed') args.seed = BigInt(argv[++i])
        else if (flag === '--mbt') args.mbt = true
        else if (flag === '--witnesses') {
          while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args.witnesses.push(argv[++i])
        } else throw new Error(`Unsupported batch argument: ${flag}`)
      }
      if (!checked) {
        checked = await commands.load(args)
        for (const command of ['parse', 'typecheck']) {
          if (checked.isLeft()) break
          checked = await commands[command](checked.value)
        }
      }
      if (checked.isRight() && checked.value.args.input !== args.input) throw new Error('A simulation batch must contain one input file')
      const result = checked.isLeft() ? checked : await commands.runSimulator({ ...checked.value, args })
      if (result.isLeft()) {
        console.error(result.value.msg)
        for (const error of result.value.stage?.errors ?? []) console.error(error.message ?? error)
        status = result.value.stage?.status === 'violation' ? 1 : 2
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
