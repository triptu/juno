// Read-only resource summary of retained run logs in every registered worktree.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function parseRun(text) {
  const json = (label) => {
    try { return JSON.parse(text.match(new RegExp(`^remote: ${label} (.+)$`, 'm'))?.[1] ?? 'null') } catch { return null }
  }
  const run = json('run')
  const summary = json('summary')
  const cpu = /CPU busy (\d+)% on average, \d+% at the median, over (\d+) s on (\d+) cores/.exec(text)
  return {
    backend: summary?.backend ?? (/^remote: backend (.+)$/m.exec(text)?.[1] ?? 'unknown'),
    script: run?.script ?? /^(?:pnpm|bun run) (\S+)/m.exec(text)?.[1] ?? 'unknown',
    code: summary?.code ?? Number(/remote: exited with (\d+)/.exec(text)?.[1] ?? NaN),
    cores: Number(/:(\d+)x/.exec(run?.machine ?? '')?.[1] ?? cpu?.[3] ?? NaN),
    busy: cpu ? Number(cpu[1]) : NaN,
    sampledSeconds: cpu ? Number(cpu[2]) : NaN,
    scriptSeconds: Number(/remote: script time (\d+) s/.exec(text)?.[1] ?? cpu?.[2] ?? NaN),
    ...summary,
  }
}

const median = (values) => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : NaN
}
const fmt = (number, digits = 1) => Number.isFinite(number) ? number.toFixed(digits) : '?'

const key = (run) => `${run.script} / ${run.backend} / ${Number.isFinite(run.cores) ? run.cores : '?'}`

export function report(runs) {
  const lines = ['Kind / backend | Runs (failed/incomplete) | Cores | Busy % | Script/sample median s | Startup median s | Wall median s | Script core-min | Held core-min | Cold share']
  for (const kind of [...new Set(runs.map(key))].toSorted()) {
    const group = runs.filter((run) => key(run) === kind)
    const scripted = group.filter((run) => Number.isFinite(run.scriptSeconds) && Number.isFinite(run.cores))
    const measured = group.filter((run) => Number.isFinite(run.machineSeconds) && Number.isFinite(run.cores))
    const cpu = group.filter((run) => Number.isFinite(run.busy))
    const samples = cpu.reduce((sum, run) => sum + run.sampledSeconds, 0)
    const known = group.filter((run) => typeof run.warm === 'boolean')
    lines.push(`${group[0].script} / ${group[0].backend} | ${group.length} (${group.filter((run) => run.code !== 0).length}) | ${[...new Set(group.map((run) => Number.isFinite(run.cores) ? run.cores : '?'))].toSorted().join(',')} | ${fmt(cpu.reduce((sum, run) => sum + run.busy * run.sampledSeconds, 0) / samples)} | ${fmt(median(group.map((run) => run.scriptSeconds)))} | ${fmt(median(group.map((run) => run.startupSeconds)))} | ${fmt(median(group.map((run) => run.wallSeconds)))} | ${scripted.length ? fmt(scripted.reduce((sum, run) => sum + run.scriptSeconds * run.cores / 60, 0)) : '?'} | ${measured.length ? fmt(measured.reduce((sum, run) => sum + run.cores * run.machineSeconds / 60, 0)) : '?'} (${measured.length}/${group.length}) | ${known.length ? fmt(100 * known.filter((run) => !run.warm).length / known.length) + '%' : '?'} (${known.length}/${group.length})`)
  }
  lines.push('Script core-min uses explicit script time or the sampled duration as a lower bound for legacy logs. Held core-min counts measured machine-held time, including creation, reports and cleanup; excludes local queue/build time. SSH runs count host reservation time. Busy % is weighted by sampled seconds. Unknown legacy fields are ?, never zero. Failed and incomplete runs remain in totals.')
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const daysAt = process.argv.indexOf('--days')
  const days = daysAt < 0 ? 7 : Number(process.argv[daysAt + 1])
  if (!(days > 0 && Number.isFinite(days))) throw new Error('--days must be a positive number')
  const trees = spawnSync('git', ['worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8' })
  if (trees.status !== 0) throw new Error(trees.stderr)
  const roots = trees.stdout.split('\0').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9))
  const runs = []
  const seen = new Set()
  for (const root of roots) {
    const dir = join(root, '.remote')
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry, 'run.log')
      if (!existsSync(path) || statSync(path).mtimeMs < Date.now() - days * 86400_000) continue
      // Copied reports in another worktree must not count twice.
      const text = readFileSync(path, 'utf8')
      const logKey = `${entry}\0${text}`
      if (seen.has(logKey)) continue
      seen.add(logKey)
      runs.push(parseRun(text))
    }
  }
  console.log(`Remote usage: last ${days} days, ${roots.length} worktrees, ${runs.length} logs`)
  console.log(report(runs))
}
