import { sampleShare } from './walk-cache.mjs'

// Adds up the `gallery-walk` notes of the walk parts and the cached rendering
// tests (noteWalk in support.ts) into one line, which verify-main keeps in the
// full-run record: how many states and tests ran without a pass to reuse, were
// reused (by the run that wrote them) and were sampled.
const empty = () => ({ walked: 0, reused: {}, sampled: 0, missed: [] })

export default class WalkReporter {
  totals = { states: empty(), tests: empty() }
  onTestEnd(_test, result) {
    for (const annotation of result.annotations ?? []) {
      if (annotation.type !== 'gallery-walk') continue
      const note = JSON.parse(annotation.description)
      const total = this.totals[note.kind]
      total.walked += note.walked
      total.sampled += note.sampled
      total.missed.push(...note.missed)
      for (const [from, count] of Object.entries(note.reused)) total.reused[from] = (total.reused[from] ?? 0) + count
    }
  }
  onEnd() {
    const sample = process.env.GALLERY_SAMPLE
    console.log(`juno-gallery-walk: ${JSON.stringify({ uncached: process.env.GALLERY_SHIFT_ALL === '1', sample: sample ? { seed: sample, share: sampleShare } : null, ...this.totals })}`)
  }
}

