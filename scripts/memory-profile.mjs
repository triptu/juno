// Samples every process in the job's container (JUNO_MEMORY_PROFILE=1, started by run.sh): resident,
// proportional and private memory per process from /proc/<pid>/smaps_rollup, and the cgroup's split
// into anonymous memory, file cache and tmpfs. Writes memory-profile/<job>.json for
// scripts/memory-report.mjs (docs/development.md, "Memory").
import { mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'

const intervalMillis = Number(process.env.JUNO_MEMORY_PROFILE_MILLIS ?? 1000)
const out = process.argv[2] ?? 'memory-profile/profile.json'
const started = Date.now()
const read = (path) => { try { return readFileSync(path, 'utf8') } catch { return undefined } }
const kb = (text, key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0)
const processes = new Map()
const samples = []

const sample = () => {
  const at = Math.round((Date.now() - started) / 1000)
  const now = { at, rss: 0, pss: 0, private: 0, count: 0, byPid: {} }
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const rollup = read(`/proc/${name}/smaps_rollup`)
    if (!rollup) continue
    const rss = kb(rollup, 'Rss')
    if (rss === 0) continue
    const pss = kb(rollup, 'Pss')
    const privateKb = kb(rollup, 'Private_Clean') + kb(rollup, 'Private_Dirty')
    let entry = processes.get(name)
    if (!entry) {
      const stat = read(`/proc/${name}/stat`) ?? ''
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      let exe = ''
      try { exe = readlinkSync(`/proc/${name}/exe`) } catch {}
      const cmd = (read(`/proc/${name}/cmdline`) ?? '').split('\0').join(' ').trim().slice(0, 400)
      entry = { pid: Number(name), ppid, exe, cmd, first: at, last: at, rssFirst: rss, rssPeak: 0, pssPeak: 0, privatePeak: 0, series: [] }
      processes.set(name, entry)
    }
    entry.last = at
    entry.rssLast = rss
    entry.pssLast = pss
    entry.rssPeak = Math.max(entry.rssPeak, rss)
    entry.pssPeak = Math.max(entry.pssPeak, pss)
    entry.privatePeak = Math.max(entry.privatePeak, privateKb)
    // Every 10th sample, for growth over a long-lived process.
    if (at % 10 === 0 && entry.series.at(-1)?.[0] !== at) entry.series.push([at, rss, pss])
    now.rss += rss
    now.pss += pss
    now.private += privateKb
    now.count++
    now.byPid[name] = pss
  }
  const stat = read('/sys/fs/cgroup/memory.stat')
  if (stat) {
    const bytes = (key) => Number(new RegExp(`^${key} (\\d+)$`, 'm').exec(stat)?.[1] ?? 0) / 1024
    Object.assign(now, { anon: bytes('anon'), file: bytes('file'), shmem: bytes('shmem'), kernel: bytes('kernel') })
  }
  now.current = Number(read('/sys/fs/cgroup/memory.current') ?? 0) / 1024
  samples.push(now)
}

const write = () => {
  mkdirSync(out.slice(0, out.lastIndexOf('/')) || '.', { recursive: true })
  writeFileSync(out, JSON.stringify({ intervalMillis, peak: Number(read('/sys/fs/cgroup/memory.peak') ?? 0) / 1024, samples, processes: [...processes.values()] }))
}

const timer = setInterval(sample, intervalMillis)
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(timer); write(); process.exit(0) })
sample()
