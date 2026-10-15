/**
 * The report: one Markdown page per run, and one row per run in
 * `reports/history.tsv`, so scores can be compared over time. The columns
 * are fixed; a new behaviour adds a column at the end.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ITEMS, type CaseResult, type Item } from './grade'

export interface RunInfo {
  readonly date: string
  readonly commit: string
  readonly mode: 'fake' | 'live'
  readonly model: string
  readonly judge: string
  readonly seconds: number
  readonly cost?: number
  readonly unknown?: number
}

interface Tally {
  readonly passed: number
  readonly total: number
}

export interface Summary {
  readonly cases: Tally
  readonly checks: Tally
  readonly items: Readonly<Record<Item, Tally>>
  readonly sources: { readonly claims: number; readonly cited: number }
  readonly errors: number
}

const items = Object.keys(ITEMS) as Item[]

export function summarize(results: ReadonlyArray<CaseResult>): Summary {
  const scored = results.flatMap((r) => r.checks).filter((c) => c.pass !== 'n/a')
  const tally = (checks: typeof scored): Tally => ({ passed: checks.filter((c) => c.pass === true).length, total: checks.length })
  return {
    cases: { passed: results.filter(passed).length, total: results.length },
    checks: tally(scored),
    items: Object.fromEntries(items.map((item) => [item, tally(scored.filter((c) => c.item === item))])) as Record<Item, Tally>,
    sources: results.reduce((s, r) => ({ claims: s.claims + (r.sources?.claims ?? 0), cited: s.cited + (r.sources?.cited ?? 0) }), { claims: 0, cited: 0 }),
    errors: results.filter((r) => r.error !== undefined).length,
  }
}

export const passed = (r: CaseResult) => r.error === undefined && r.checks.every((c) => c.pass !== false)

const share = (t: Tally) => (t.total === 0 ? 'n/a' : `${Math.round((100 * t.passed) / t.total)}%`)
const ratio = (t: Tally) => `${t.passed}/${t.total}`

export function markdown(info: RunInfo, results: ReadonlyArray<CaseResult>): string {
  const s = summarize(results)
  const lines = [
    `# Juno Agent eval, ${info.date}, ${info.model}`,
    '',
    `${info.mode} · commit ${info.commit} · judge ${info.judge} · ${results.length} cases · ${Math.round(info.seconds)} s`,
    '',
    ...(info.cost === undefined ? [] : [`Chat and judge cost: $${info.cost.toFixed(6)}. Requests with unknown cost: ${info.unknown ?? 0}.`, '']),
    '| Behaviour | Passed | Score |',
    '| --- | --- | --- |',
    ...items.map((item) => `| ${ITEMS[item]} | ${ratio(s.items[item])} | ${share(s.items[item])} |`),
    `| All checks | ${ratio(s.checks)} | ${share(s.checks)} |`,
    `| Cases with every check passed | ${ratio(s.cases)} | ${share(s.cases)} |`,
    '',
    `Slack claims with a source: ${s.sources.cited} of ${s.sources.claims} (${share({ passed: s.sources.cited, total: s.sources.claims })}).` +
      (s.errors > 0 ? ` ${s.errors} case(s) could not be graded.` : ''),
  ]
  const failures = results.flatMap((r) =>
    r.error !== undefined ? [`- ${r.id}: not graded, ${r.error}`] : r.checks.filter((c) => c.pass === false).map((c) => `- ${r.id} · ${c.name} (${c.kind}): ${c.detail}`),
  )
  if (failures.length > 0) lines.push('', '## Failed', '', ...failures)
  const skipped = [...new Set(results.flatMap((r) => r.checks.filter((c) => c.pass === 'n/a').map((c) => `${c.name}: ${c.detail}`)))]
  if (skipped.length > 0) lines.push('', '## Not scored in this build', '', ...skipped.map((line) => `- ${line}`))
  return `${lines.join('\n')}\n`
}

const HEADER = ['date', 'commit', 'mode', 'model', 'judge', 'cases', 'checks', ...items, 'cited'].join('\t')

export function historyRow(info: RunInfo, results: ReadonlyArray<CaseResult>): string {
  const s = summarize(results)
  return [info.date, info.commit, info.mode, info.model, info.judge, ratio(s.cases), ratio(s.checks), ...items.map((i) => ratio(s.items[i])), `${s.sources.cited}/${s.sources.claims}`].join('\t')
}

/** Every case's transcript, as the judge read it. */
export const transcripts = (results: ReadonlyArray<CaseResult>): string => results.map((r) => `# ${r.id}\n\n${r.transcript ?? r.error ?? ''}\n`).join('\n')

/**
 * Writes `<date>-<model>.md`, appends the history row, and writes every
 * case's transcript beside the page (`.transcripts.md`, not committed).
 * Returns the page's path.
 */
export function save(dir: string, info: RunInfo, results: ReadonlyArray<CaseResult>): string {
  mkdirSync(dir, { recursive: true })
  const name = `${info.date}-${info.model.replace(/[^\w.-]+/g, '-')}-${info.commit}`
  const page = join(dir, `${name}.md`)
  writeFileSync(page, markdown(info, results))
  writeFileSync(join(dir, `${name}.transcripts.md`), transcripts(results))
  const history = join(dir, 'history.tsv')
  if (!existsSync(history)) writeFileSync(history, `${HEADER}\n`)
  appendFileSync(history, `${historyRow(info, results)}\n`)
  return page
}
