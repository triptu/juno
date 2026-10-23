/**
 * `bun run notif:replay report`: the labels against the new decision and the
 * old one, the misses by reason, and a sweep of each constant. Rates are
 * weighted by how many replayed messages each label stands for. Message
 * text is printed only with `--show-text`.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { currentKnobs, decideAll, type Knobs } from './policy'
import { flags, needsSum, readJson, required, type Labels, type Replay, type ReplayItem, type SampleEntry } from './model'

interface Scored {
  readonly item: ReplayItem
  readonly label: 'notify' | 'stay'
  readonly weight: number
}

interface Metrics {
  readonly perDay: number
  readonly agreement: number
  readonly recall: number
  readonly precision: number
  readonly n: number
}

const pct = (value: number) => (Number.isFinite(value) ? `${(100 * value).toFixed(0)}%` : '-')

function metrics(scored: ReadonlyArray<Scored>, notified: (item: ReplayItem) => boolean, notifications: number, days: number): Metrics {
  let agree = 0
  let total = 0
  let wanted = 0
  let caught = 0
  let rang = 0
  let rightRang = 0
  for (const { item, label, weight } of scored) {
    const yes = notified(item)
    total += weight
    if (yes === (label === 'notify')) agree += weight
    if (label === 'notify') {
      wanted += weight
      if (yes) caught += weight
    }
    if (yes) {
      rang += weight
      if (label === 'notify') rightRang += weight
    }
  }
  return { perDay: notifications / days, agreement: agree / total, recall: caught / wanted, precision: rightRang / rang, n: scored.length }
}

const row = (cells: ReadonlyArray<string>, widths: ReadonlyArray<number>) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 10)).join('  ')

const newNotified = (item: ReplayItem) => item.decision.outcome === 'notify'

/** The new decision on every label, and the old check against the new one on the labels the old log has. */
function compare(replay: Replay, scored: ReadonlyArray<Scored>) {
  // The sweep's copy of the decision must agree with the real one at today's constants.
  const mirrored = decideAll(replay.items, currentKnobs, replay.instructions)
  const differ = replay.items.filter((item) => mirrored.get(item.id)?.outcome !== item.decision.outcome).length
  if (differ > 0) console.log(`Warning: the sweep's decision differs from the real one on ${differ} messages. The sweeps below are not trustworthy.`)
  const now = metrics(scored, newNotified, replay.items.filter(newNotified).length, replay.days)
  console.log(`\nNew decision: ${now.perDay.toFixed(1)} notifications a day, agreement ${pct(now.agreement)}, recall ${pct(now.recall)}, precision ${pct(now.precision)}.`)
  const withOld = scored.filter((s) => s.item.old !== undefined)
  if (withOld.length === 0) {
    console.log('Old check: no labelled message is in the old notification log.')
    return
  }
  const old = metrics(withOld, (item) => item.old?.outcome === 'notify', 0, 1)
  const same = metrics(withOld, newNotified, 0, 1)
  console.log(`Old check, on the ${withOld.length} labelled messages it logged: agreement ${pct(old.agreement)}, recall ${pct(old.recall)}, precision ${pct(old.precision)}.`)
  console.log(`New decision on the same messages: agreement ${pct(same.agreement)}, recall ${pct(same.recall)}, precision ${pct(same.precision)}.`)
}

/** Wrong decisions grouped by what decided them. Text only with `--show-text`. */
function listWrong(title: string, wrong: ReadonlyArray<Scored>, showText: boolean) {
  console.log(`\n${title}: ${wrong.length}`)
  const groups = new Map<string, Scored[]>()
  for (const s of wrong) {
    const reading = typeof s.item.reading === 'object' ? s.item.reading : undefined
    const key = s.item.decision.decidedBy === 'reading' && reading !== undefined ? `reading: ${reading.needsYou}` : s.item.decision.decidedBy
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  for (const [key, group] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${key} (${group.length})`)
    for (const { item } of group) {
      const reading = typeof item.reading === 'object' ? ` needs ${needsSum(item, item.reading).toFixed(2)}` : ''
      const live = item.facts.ownerWroteMinutesAgo === undefined ? '' : ` you wrote ${Math.round(item.facts.ownerWroteMinutesAgo)} min before`
      console.log(`    ${new Date(item.at).toLocaleString()}  ${item.kind}${reading}${live}  ${item.id}`)
      if (showText) console.log(`      ${item.where} · ${item.sender}: ${item.text.replace(/\s+/g, ' ').slice(0, 140)}\n      ${item.decision.reason}`)
    }
  }
}

interface SweepInput {
  readonly replay: Replay
  readonly scored: ReadonlyArray<Scored>
  /** The labels the constants can move: messages that reach Auto's live or reading steps. */
  readonly auto: ReadonlyArray<Scored>
  readonly target: number
}

/** One constant over `values`, the others as they are now. Returns the value with the fewest banners a day whose Auto recall reaches the target. */
function sweep({ replay, scored, auto, target }: SweepInput, name: string, knob: keyof Knobs, values: ReadonlyArray<number>): number {
  console.log(`\n${name} (now ${currentKnobs[knob]})`)
  const widths = [8, 8, 14, 12, 16, 16]
  console.log(row(['value', 'a day', 'recall (Auto)', 'recall (all)', 'precision (Auto)', 'agreement (Auto)'], widths))
  const results = values.map((value) => {
    const decided = decideAll(replay.items, { ...currentKnobs, [knob]: value }, replay.instructions)
    const notified = (item: ReplayItem) => decided.get(item.id)?.outcome === 'notify'
    const m = metrics(auto, notified, replay.items.filter(notified).length, replay.days)
    const overall = metrics(scored, notified, 0, replay.days)
    console.log(row([String(value), m.perDay.toFixed(1), pct(m.recall), pct(overall.recall), pct(m.precision), pct(m.agreement)], widths))
    return { value, ...m }
  })
  const enough = results.filter((r) => r.recall >= target)
  const distance = (value: number) => Math.abs(value - currentKnobs[knob])
  const best = enough.length > 0
    ? enough.reduce((a, b) => (b.perDay < a.perDay || (b.perDay === a.perDay && distance(b.value) < distance(a.value)) ? b : a))
    : results.reduce((a, b) => (b.recall > a.recall ? b : a))
  console.log(enough.length > 0
    ? `Recommended: ${best.value}, the fewest notifications (${best.perDay.toFixed(1)} a day) with recall at least ${pct(target)}.`
    : `No value reaches recall ${pct(target)}. The highest recall is at ${best.value} (${pct(best.recall)}, ${best.perDay.toFixed(1)} a day).`)
  return best.value
}

const steps = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Number((from + i * step).toFixed(2)))

function sweepAll(input: SweepInput) {
  const { replay, scored, auto } = input
  console.log(`\nSweeps: ${auto.length} labelled messages reach the live or reading step. "a day" counts every replayed banner.`)
  const recommended: Partial<Record<keyof Knobs, number>> = {
    needsYou: sweep(input, 'Needs-you sum, NEEDS_YOU_THRESHOLD', 'needsYou', steps(0.2, 0.8, 0.05)),
    liveMinutes: sweep(input, 'Live conversation window in minutes, LIVE_MINUTES', 'liveMinutes', [0, 1, 2, 3, 5, 7, 10, 15, 20, 30]),
  }
  const instructed = replay.instructions.length > 0 && replay.items.some((item) => typeof item.reading === 'object' && item.reading.instruction !== undefined)
  const has = (direction: 'notify' | 'stay') => instructed && replay.instructions.some((entry) => entry.direction === direction)
  if (has('notify')) recommended.instructionNotify = sweep(input, 'Notify me instruction confidence, INSTRUCTION_NOTIFY_CONFIDENCE', 'instructionNotify', steps(0.5, 0.95, 0.05))
  if (has('stay')) recommended.instructionStay = sweep(input, "Don't notify instruction confidence, INSTRUCTION_STAY_CONFIDENCE", 'instructionStay', steps(0.5, 0.95, 0.05))
  if (!instructed) console.log('\nInstruction thresholds: not measured. The replay had no instructions, or the reading never chose one. Rerun with --instructions FILE to measure them.')
  console.log('\nRecommended constants (each swept with the others at their current values):')
  console.log(`  NEEDS_YOU_THRESHOLD = ${recommended.needsYou}`)
  console.log(`  LIVE_MINUTES = ${recommended.liveMinutes}`)
  console.log(`  INSTRUCTION_NOTIFY_CONFIDENCE = ${recommended.instructionNotify ?? `${currentKnobs.instructionNotify} (unchanged, not measured)`}`)
  console.log(`  INSTRUCTION_STAY_CONFIDENCE = ${recommended.instructionStay ?? `${currentKnobs.instructionStay} (unchanged, not measured)`}`)
  const all = decideAll(replay.items, { ...currentKnobs, ...recommended }, replay.instructions)
  const together = metrics(scored, (item) => all.get(item.id)?.outcome === 'notify', [...all.values()].filter((o) => o.outcome === 'notify').length, replay.days)
  console.log(`  Together: ${together.perDay.toFixed(1)} notifications a day, recall ${pct(together.recall)}, precision ${pct(together.precision)}, agreement ${pct(together.agreement)}.`)
}

export async function report(argv: ReadonlyArray<string>) {
  const options = flags(argv)
  const replay = readJson<Replay>(resolve(required(options, 'replay')))
  const labelsPath = resolve(required(options, 'labels'))
  const samplePath = resolve(options.sample ?? join(dirname(labelsPath), 'sample.json'))
  const labels = existsSync(labelsPath) ? readJson<Labels>(labelsPath) : {}
  const entries = readJson<{ entries: ReadonlyArray<SampleEntry> }>(samplePath).entries
  const byId = new Map(replay.items.map((item) => [item.id, item]))
  const scored: Scored[] = entries.flatMap((entry) => {
    const item = byId.get(entry.id)
    const label = labels[entry.id]?.label
    return item === undefined || label === undefined ? [] : [{ item, label, weight: entry.weight }]
  })
  console.log(`${replay.items.length} replayed messages over ${replay.days} days; ${scored.length} of ${entries.length} sampled messages labelled, ${scored.filter((s) => s.label === 'notify').length} as notify.`)
  if (scored.length === 0) return
  compare(replay, scored)
  const showText = options['show-text'] === 'true'
  listWrong('Misses (labelled notify, the new decision stayed)', scored.filter((s) => s.label === 'notify' && !newNotified(s.item)), showText)
  listWrong("Extra banners (labelled don't notify, the new decision notified)", scored.filter((s) => s.label === 'stay' && newNotified(s.item)), showText)
  sweepAll({ replay, scored, auto: scored.filter((s) => s.item.early === undefined), target: Number(options.recall ?? 0.9) })
}
