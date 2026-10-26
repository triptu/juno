// Summarizes the memory profiles a remote run with JUNO_MEMORY_PROFILE=1 brings back
// (scripts/memory-profile.mjs): `bun scripts/memory-report.mjs .remote/<run>/memory-profile/*.json`.
// Prints each kind of process's peak resident, proportional and private memory, the peak of the
// whole job, and processes that grew over their life.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// The first rule a process's command line matches names its kind.
const kinds = [
  [/java\b.*apalache|apalache.*java/i, 'Apalache JVM'],
  [/\bjava\b/, 'JVM (other)'],
  [/quint/, 'Quint'],
  [/memory-profile\.mjs/, 'profiler'],
  [/vite build|electron-vite build|build-host\.mjs/, 'build (vite, electron-vite)'],
  [/workerProcessEntry/, 'Playwright worker'],
  [/bun(?:\.exe)? test --test-worker/, 'bun test worker'],
  [/ms-playwright.*--type=renderer|headless_shell.*--type=renderer|chrom.*--type=renderer/, 'Chromium renderer'],
  [/ms-playwright.*--type=gpu-process|headless_shell.*--type=gpu-process|chrom.*--type=gpu-process/, 'Chromium GPU'],
  [/ms-playwright.*--type=utility|headless_shell.*--type=utility|chrom.*--type=utility/, 'Chromium utility'],
  [/ms-playwright.*--type=zygote|headless_shell.*--type=zygote|chrom.*--type=zygote/, 'Chromium zygote'],
  [/ms-playwright|headless_shell|chrome-linux|chromium/, 'Chromium browser'],
  [/electron.*--type=renderer/, 'Electron renderer'],
  [/electron.*--type=gpu-process/, 'Electron GPU'],
  [/electron.*--type=utility/, 'Electron utility (engine, agent, network)'],
  [/electron.*--type=zygote/, 'Electron zygote'],
  [/electron/, 'Electron main'],
  [/testHost\.mjs/, 'engine host (test host)'],
  [/playwright.*test|playwright\.js test|playwright test/, 'Playwright runner'],
  [/vite.*preview|vite preview/, 'vite preview server'],
  [/bun(?:\.exe)? test/, 'bun test (parent)'],
  [/Xvfb/, 'Xvfb'],
]
const kindOf = (process) => {
  const text = `${process.exe} ${process.cmd}`
  return kinds.find(([pattern]) => pattern.test(text))?.[1] ?? `other: ${basename(process.exe || process.cmd.split(' ')[0] || '?')}`
}
const gb = (kb) => (kb / 1048576).toFixed(2)
const mb = (kb) => Math.round(kb / 1024)

for (const file of process.argv.slice(2)) {
  const profile = JSON.parse(readFileSync(file, 'utf8'))
  const peakSample = profile.samples.reduce((best, sample) => sample.pss > best.pss ? sample : best, profile.samples[0])
  console.log(`\n${file}: ${profile.samples.length} samples; cgroup peak ${gb(profile.peak)} GB; summed PSS peak ${gb(peakSample.pss)} GB at ${peakSample.at} s (anon ${gb(peakSample.anon ?? 0)}, file ${gb(peakSample.file ?? 0)}, tmpfs ${gb(peakSample.shmem ?? 0)} GB)`)
  const byKind = new Map()
  for (const process of profile.processes) {
    const kind = kindOf(process)
    const entry = byKind.get(kind) ?? { kind, count: 0, rss: 0, pss: 0, private: 0, sumPss: 0 }
    entry.count++
    entry.rss = Math.max(entry.rss, process.rssPeak)
    entry.pss = Math.max(entry.pss, process.pssPeak)
    entry.private = Math.max(entry.private, process.privatePeak)
    byKind.set(kind, entry)
  }
  // Each kind's PSS summed over its live processes, at its own highest sample and at the job's peak.
  const kindByPid = new Map(profile.processes.map((process) => [String(process.pid), kindOf(process)]))
  for (const sample of profile.samples) {
    const sums = new Map()
    for (const [pid, pss] of Object.entries(sample.byPid ?? {})) sums.set(kindByPid.get(pid), (sums.get(kindByPid.get(pid)) ?? 0) + pss)
    for (const [kind, sum] of sums) {
      const entry = byKind.get(kind)
      if (!entry) continue
      entry.sumPss = Math.max(entry.sumPss, sum)
      if (sample === peakSample) entry.atPeak = sum
    }
  }
  console.log('| Kind | Processes | Largest RSS MB | Largest PSS MB | Largest private MB | Kind PSS peak MB | At job peak MB |')
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const entry of [...byKind.values()].toSorted((a, b) => b.sumPss - a.sumPss || b.pss - a.pss)) console.log(`| ${entry.kind} | ${entry.count} | ${mb(entry.rss)} | ${mb(entry.pss)} | ${mb(entry.private)} | ${mb(entry.sumPss)} | ${mb(entry.atPeak ?? 0)} |`)
  // Growth: a process alive for 60 s or more whose resident memory at its end is well above its start.
  const grew = profile.processes.filter((process) => process.last - process.first >= 60 && process.series.length >= 3)
    .map((process) => ({ process, from: process.series[1]?.[1] ?? process.rssFirst, to: process.series.at(-1)[1] }))
    .filter(({ from, to }) => to > from * 1.3 && to - from > 100 * 1024)
  if (grew.length > 0) {
    console.log('\nGrew over its life (RSS MB at its second tenth-sample, then last):')
    for (const { process, from, to } of grew) console.log(`- ${kindOf(process)} pid ${process.pid}, ${process.first}-${process.last} s: ${mb(from)} -> ${mb(to)} (${process.series.map((point) => mb(point[1])).join(' ')})`)
  }
}
