/**
 * `pnpm notif:replay sample`: picks about 300 replayed messages to label,
 * stratified by what decided them and the kind of conversation, with
 * borderline readings oversampled, and writes the labelling page.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { flags, needsSum, readJson, required, writeJson, type Replay, type ReplayItem, type SampleEntry } from './model'
import { page, type PageItem } from './page'

/** Borderline strata get this much more of the sample than their size alone would give. */
const BORDERLINE_BOOST = 2.5
/** The context the page shows above the message. */
const SHOWN_BEFORE = 6

/** A reading near the needs-you line, or the owner wrote 3 to 30 minutes before: where the constants move outcomes. */
function borderline(item: ReplayItem): boolean {
  if (item.early !== undefined) return false
  const minutes = item.facts.ownerWroteMinutesAgo
  if (minutes !== undefined && minutes >= 3 && minutes <= 30) return true
  if (typeof item.reading !== 'object') return false
  const sum = needsSum(item.reading)
  return (sum >= 0.25 && sum <= 0.75) || (item.reading.instruction !== undefined && item.reading.instruction.confidence >= 0.5)
}

const stratumOf = (item: ReplayItem) => `${borderline(item) ? 'borderline' : item.decision.decidedBy} · ${item.kind}`

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<A>(values: ReadonlyArray<A>, next: () => number): A[] {
  const out = [...values]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Shares of `size` by the square root of each stratum's size (boosted when borderline), capped at the stratum's size. */
function allocate(strata: ReadonlyMap<string, number>, size: number): Map<string, number> {
  const out = new Map([...strata.keys()].map((key) => [key, 0]))
  let left = Math.min(size, [...strata.values()].reduce((a, b) => a + b, 0))
  while (left > 0) {
    const open = [...strata].filter(([key, n]) => out.get(key)! < n)
    const weight = (key: string, n: number) => Math.sqrt(n) * (key.startsWith('borderline') ? BORDERLINE_BOOST : 1)
    const total = open.reduce((sum, [key, n]) => sum + weight(key, n), 0)
    let given = 0
    for (const [key, n] of open) {
      const share = Math.min(n - out.get(key)!, Math.max(1, Math.floor((left * weight(key, n)) / total)))
      out.set(key, out.get(key)! + share)
      given += share
      if (given >= left) break
    }
    left -= given
  }
  return out
}

export async function sample(argv: ReadonlyArray<string>) {
  const options = flags(argv)
  const replayPath = resolve(required(options, 'replay'))
  const dir = resolve(required(options, 'out'))
  const size = Number(options.size ?? 300)
  const next = random(Number(options.seed ?? 1))
  const replay = readJson<Replay>(replayPath)
  const groups = new Map<string, ReplayItem[]>()
  for (const item of replay.items) {
    const key = stratumOf(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const counts = allocate(new Map([...groups].map(([key, items]) => [key, items.length])), size)
  const entries: SampleEntry[] = []
  const chosen: ReplayItem[] = []
  for (const [key, items] of groups) {
    const n = counts.get(key)!
    for (const item of shuffle(items, next).slice(0, n)) {
      entries.push({ id: item.id, stratum: key, weight: items.length / n })
      chosen.push(item)
    }
  }
  const order = shuffle(chosen, next)
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'sample.json'), { replay: replayPath, entries })
  const items: PageItem[] = order.map((item) => ({
    id: item.id, at: item.at, kind: item.kind, where: item.where, sender: item.sender, text: item.text, mentionsMe: item.mentionsMe,
    ...(item.threadRoot === undefined ? {} : { threadRoot: item.threadRoot }),
    before: item.before.slice(-SHOWN_BEFORE),
  }))
  const report = `pnpm notif:replay report --replay ${replayPath} --labels ${join(dir, 'labels.json')}`
  writeFileSync(join(dir, 'index.html'), page(items, { serve: `pnpm notif:replay label --dir ${dir}`, report }))
  console.log(`${entries.length} messages from ${groups.size} strata:`)
  for (const [key, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${key}: ${counts.get(key)} of ${items.length}`)
  console.log(`Wrote ${join(dir, 'index.html')}. Label with: pnpm notif:replay label --dir ${dir}`)
}
