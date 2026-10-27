import type { FullResult, Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter'

/**
 * Under JUNO_E2E_TIMINGS=1, prints one `e2e-timing:` JSON line per test run: where its
 * time went (fixture setup and teardown, fixed waits, polls, other expects and API
 * calls), the `e2e timing:` phases the fixtures and driver print, each top-level
 * `test.step` (title and milliseconds, in order), and its worker and start time.
 * `bun scripts/e2e-timings.mjs <run.log>` sums them.
 */
export default class TimingReporter implements Reporter {
  readonly #phases = new Map<TestResult, Record<string, number>>()
  readonly #buckets = new Map<TestResult, Record<string, number>>()
  readonly #journey = new Map<TestResult, Array<{ readonly title: string; readonly ms: number }>>()
  #begun = 0

  onBegin(): void {
    this.#begun = Date.now()
  }

  onStdOut(chunk: string | Buffer, _test: TestCase | undefined, result: TestResult | undefined): void {
    if (result === undefined) return
    const phases = this.#phases.get(result) ?? {}
    for (const [, name, ms] of String(chunk).matchAll(/e2e timing: ([\w-]+) (\d+) ms/g)) phases[name!] = (phases[name!] ?? 0) + Number(ms)
    this.#phases.set(result, phases)
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category === 'test.step' && step.parent === undefined) this.#journey.set(result, [...this.#journey.get(result) ?? [], { title: step.title, ms: step.duration }])
    const bucket = bucketOf(step)
    if (bucket === undefined) return
    // Count the outermost call only: an expect's own API calls are part of the expect, a fixture's part of its hook.
    for (let parent = step.parent; parent !== undefined; parent = parent.parent) if (bucketOf(parent) !== undefined) return
    const buckets = this.#buckets.get(result) ?? {}
    buckets[bucket] = (buckets[bucket] ?? 0) + step.duration
    this.#buckets.set(result, buckets)
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const line = {
      file: test.location.file.replace(/^.*[/\\]e2e[/\\]/, ''),
      title: test.title,
      status: result.status,
      retry: result.retry,
      worker: result.parallelIndex,
      start: result.startTime.getTime() - this.#begun,
      ms: result.duration,
      steps: this.#buckets.get(result) ?? {},
      phases: this.#phases.get(result) ?? {},
      testSteps: this.#journey.get(result) ?? [],
    }
    console.log(`e2e-timing: ${JSON.stringify(line)}`)
  }

  onEnd(_result: FullResult): void {
    console.log(`e2e-timing-end: ${JSON.stringify({ ms: Date.now() - this.#begun })}`)
  }
}

/** Fixed waits, polls, other expects, other API calls, and the hooks around the body. */
function bucketOf(step: TestStep): string | undefined {
  if (step.category === 'hook' && step.title === 'Before Hooks') return 'before'
  if (step.category === 'hook' && step.title === 'After Hooks') return 'after'
  if (step.category === 'pw:api') return /timeout/i.test(step.title) ? 'sleep' : /evaluate/i.test(step.title) ? 'evaluate' : 'api'
  if (step.category === 'expect') return /poll|toPass/i.test(step.title) ? 'poll' : 'expect'
  return undefined
}
