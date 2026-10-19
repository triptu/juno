import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { forwardSignals } from './children.mjs'

export async function runShards({ total, rest, self, root, desktop, dryRun }) {
  if (!Number.isInteger(total) || total < 1 || total > 24) throw new Error('--shards must be an integer from 1 to 24')
  const group = join(root, '.remote', `shards-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`)
  const blobs = join(group, 'blobs')
  if (desktop && !dryRun) mkdirSync(blobs, { recursive: true })
  const children = new Set()
  forwardSignals(children)
  const codes = await Promise.all(Array.from({ length: total }, (_, index) => new Promise((resolve) => {
    const args = [self, '--env', `JUNO_SHARD=${index}/${total}`, ...rest]
    if (desktop) args.push(`--shard=${index + 1}/${total}`, '--reporter=line,blob')
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, JUNO_RUNNER_PARENT: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    children.add(child)
    let report
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => {
      console.log(`[${index + 1}/${total}] ${line}`)
      const match = /^remote: output in (.+\/run\.log)$/.exec(line)
      if (match) report = dirname(join(root, match[1]))
    })
    child.on('error', () => resolve(255))
    child.on('close', (code) => {
      children.delete(child)
      const source = report && join(report, 'apps/desktop/blob-report')
      if (desktop && !dryRun) {
        const files = source && existsSync(source) ? readdirSync(source).filter((name) => name.endsWith('.zip')) : []
        if (!files.length) { console.error(`remote: shard ${index + 1} has no blob report`); code ||= 255 }
        for (const name of files) cpSync(join(source, name), join(blobs, `${index + 1}-${name}`))
      }
      resolve(code ?? 1)
    })
  })))
  if (desktop && !dryRun && readdirSync(blobs).length) {
    const merged = spawnSync('pnpm', ['--filter', '@juno/desktop', 'exec', 'playwright', 'merge-reports', '--reporter=html', blobs], {
      cwd: root, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: join(group, 'html'), PLAYWRIGHT_HTML_OPEN: 'never' },
    })
    if (merged.status !== 0) codes.push(merged.status ?? 255)
    console.log(`remote: merged desktop report in ${join(group, 'html')}`)
  }
  console.error(`remote: shards exited with ${codes.join(', ')}`)
  return Math.max(...codes)
}
