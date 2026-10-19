import { spawn } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { hostCommand, localHint } from './runner.mjs'

/** Keep stdin open after the upload: EOF or a missed heartbeat releases the host lease. */
export function streamJob(config, args, tarball, log) {
  const ssh = spawn('ssh', [...config.args, hostCommand('run', args)], { stdio: ['pipe', 'pipe', 'pipe'] })
  const upload = createReadStream(tarball)
  let heartbeat, reported, artifacts = false, stopped = false, failure
  const stop = () => { stopped = true; ssh.kill('SIGTERM') }
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) process.on(signal, stop)
  ssh.stdin.on('error', () => {})
  ssh.stdin.write(`${statSync(tarball).size}\n`)
  upload.pipe(ssh.stdin, { end: false })
  upload.on('end', () => { heartbeat = setInterval(() => ssh.stdin.write('.\n'), 10_000) })
  upload.on('error', (error) => { failure = error; ssh.kill('SIGTERM') })
  ssh.on('error', (error) => { failure = error })
  createInterface({ input: ssh.stdout }).on('line', log)
  createInterface({ input: ssh.stderr }).on('line', (line) => {
    const marker = /^__runner_(exit|artifacts|busy)\b ?(.*)$/.exec(line)
    if (!marker) return log(line)
    if (marker[1] === 'exit') reported = /^\d+$/.test(marker[2]) ? Number(marker[2]) : undefined
    if (marker[1] === 'artifacts') artifacts = true
    if (marker[1] === 'busy') log(`remote: runner stayed full past the wait; ${localHint}.`)
  })
  return new Promise((resolve, reject) => ssh.on('close', (status) => {
    clearInterval(heartbeat)
    upload.destroy()
    for (const signal of signals) process.off(signal, stop)
    if (failure) return reject(failure)
    if (stopped) return resolve({ code: 130, artifacts })
    if (reported === undefined || status !== reported) return reject(new Error(`lost the connection before the job completed (SSH ${status}); ${localHint}.`))
    resolve({ code: reported, artifacts })
  }))
}

export function keepAwake() {
  if (process.platform !== 'darwin') return () => {}
  const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
  child.on('error', (error) => console.error(`remote: cannot keep this Mac awake: ${error.message}`))
  return () => child.kill()
}
