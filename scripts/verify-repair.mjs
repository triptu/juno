import { sameIdentity } from './verify-inputs.mjs'

export function suitePassed(suite) {
  return suite.code === 0 && !suite.unfinished && (!suite.tests || (suite.tests.status === 'passed' && suite.tests.errors === 0 && suite.tests.incomplete === 0 && suite.tests.failures.length === 0))
}

/** Repair every failed/unfinished file plus all reachable work, without a budget. */
export function repairPlan({ baseline, identity, suites, affected: selected }) {
  // affected runs typecheck and lint on this Mac and names the app suites test:desktop. A full run
  // has no local steps, and its app suites may be the browser and Electron lanes. A spec test:desktop
  // names may have tests in one lane only, so a lane given only such specs passes with none.
  const lanes = suites.map((suite) => suite.name).filter((name) => name === 'test:browser' || name === 'test:electron')
  const affected = selected.filter((step) => !step.local)
    .flatMap((step) => step.script === 'test:desktop' && lanes.length > 0 ? lanes.map((script) => ({ ...step, script, split: true })) : [step])
  if (!sameIdentity(baseline.identity, identity)) throw new Error('Repair runtime/platform differs from the baseline; start a full run')
  if (baseline.suites.some((suite) => ['perf @mac', 'test:feel', 'test:desktop @mac'].includes(suite.suite)))
    throw new Error('Repair of a Mac timing run needs a fresh --with-mac full run')
  const coordinatorFailed = baseline.suites.some((suite) => ['plan', 'setup'].includes(suite.suite) && !suitePassed(suite))
  // Timed perf is on demand and not part of a repair (docs/performance.md 7.3).
  const all = [...suites, ...baseline.suites.filter((previous) => !['plan', 'setup', 'perf', 'perf:part1', 'perf:part2'].includes(previous.suite) && !suites.some((suite) => suite.name === previous.suite))
    .map((previous) => ({ name: previous.suite, words: [previous.suite] }))]
  const planned = []
  const reused = []
  for (const suite of all) {
    const previous = coordinatorFailed ? undefined : baseline.suites.find((item) => item.suite === suite.name)
    const reached = affected.find((item) => item.script === suite.name)
    if (previous && suitePassed(previous) && !reached) {
      reused.push({ ...previous, reusedFrom: { commit: baseline.commit, finishedAt: baseline.finishedAt } })
      continue
    }
    // Unknown coverage, process crashes and unstructured suites need the whole suite.
    const completeInventory = previous?.tests?.cases?.length > 0 && previous.tests.errors === 0
    const failures = completeInventory ? previous.tests.cases.filter((test) => !['expected', 'flaky'].includes(test.outcome) && test.expectedStatus !== 'skipped') : []
    const files = failures.map((test) => test.file)
    const selective = previous && (suitePassed(previous) || (completeInventory && files.length > 0 && files.every(Boolean)))
      && (!reached || reached.args.length > 0) && /^test:(desktop|browser|electron|gallery)$/.test(suite.name)
    if (selective) {
      const prefix = suite.name === 'test:gallery' ? 'apps/gallery/' : 'apps/desktop/'
      const args = [...new Set([...files.map((file) => file.replace(prefix, '')), ...(reached?.args ?? [])])]
      // A full failed gallery spec must not inherit a component-only filter.
      const env = { ...reached?.env }
      if (files.length) delete env.GALLERY_SHIFT_ONLY
      planned.push({ ...suite, words: [...Object.entries(env).map(([key, value]) => `${key}=${value}`), suite.name, ...(reached?.split ? ['--pass-with-no-tests'] : []), ...args] })
    } else if (previous && suitePassed(previous) && reached) {
      planned.push({ ...suite, words: [...Object.entries(reached.env ?? {}).map(([key, value]) => `${key}=${value}`), suite.name, ...(reached.split ? ['--pass-with-no-tests'] : []), ...reached.args] })
    } else planned.push(suite)
  }
  for (const step of affected.filter((item) => !all.some((suite) => suite.name === item.script)))
    planned.push({ name: step.script, words: [...Object.entries(step.env ?? {}).map(([key, value]) => `${key}=${value}`), step.script, ...step.args] })
  return { planned, reused }
}

/** A repair carries complete evidence forward so a later repair can use it. */
export function mergeRepairTests(previous, current) {
  if (!previous?.cases || !current?.cases) return current
  const replaced = new Set(current.cases.map((test) => `${test.project}:${test.file}`))
  const cases = [...previous.cases.filter((test) => !replaced.has(`${test.project}:${test.file}`)), ...current.cases]
  return { ...current, cases, failures: cases.filter((test) => test.outcome === 'unexpected'), flaky: cases.filter((test) => test.outcome === 'flaky'), incomplete: cases.filter((test) => test.expectedStatus !== 'skipped' && (test.attempts.length === 0 || test.attempts.some((run) => run.status === 'interrupted'))).length }
}
