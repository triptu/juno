import { suitePassed } from './verify-repair.mjs'

// Keep coordinator failures even when every test step finished successfully.
export function planOutcomes(lines, suites, planned) {
  const results = suites.map((suite, index) => {
    const result = lines.map((line) => /^plan: step (\d+) (\S+) exited with (\d+)(?: after (\d+) s)?/.exec(line))
      .find((match) => match && Number(match[1]) === index && match[2] === suite.name)
    return { suite: suite.name, code: result ? Number(result[3]) : planned.code || 1, seconds: result?.[4] ? Number(result[4]) : planned.seconds, unfinished: !result || !result[4] }
  })
  return planned.code !== 0 && results.every((result) => result.code === 0) ? [...results, { ...planned, suite: 'plan' }] : results
}

/** How often a full run walks every gallery state with no record reused. */
export const uncachedGalleryDays = 7

/**
 * Whether a full run's gallery walks every state uncached: with `noCache`, or when the last passed uncached walk on
 * record (a full run's gallery with GALLERY_SHIFT_ALL=1, kept by a repair too) finished more than seven days ago.
 * Otherwise it reuses the records of unchanged states and checks a fresh sample of them again.
 */
export function galleryWalk(records, { noCache = false, now = Date.now() } = {}) {
  const walks = records.filter((record) => record.smoke !== true).flatMap((record) => record.suites
    .filter((suite) => suite.suite === 'test:gallery' && suitePassed(suite) && (suite.command ?? []).includes('GALLERY_SHIFT_ALL=1'))
    .map((suite) => suite.reusedFrom?.finishedAt ?? record.finishedAt))
  const last = walks.toSorted().at(-1)
  const uncached = noCache || last === undefined || now - Date.parse(last) > uncachedGalleryDays * 24 * 60 * 60 * 1000
  return { uncached, last, reason: noCache ? '--no-cache' : last === undefined ? 'no uncached walk on record' : uncached ? `the last uncached walk finished ${last}` : undefined }
}

/**
 * The suites of a full run: every test, including the @heavy ones (scripts/test-areas.mjs). Conformance replays its
 * traces against the engine every time but reuses the traces while outbox.qnt, its imports, the seed and the Quint
 * version are unchanged; the spec check reuses unchanged checks, as it proves the models, not Juno's code. The gallery
 * walks the states whose walk-cache key changed plus the `gallerySample` seed's sample of the others, and reuses the
 * rest; without a sample seed (`galleryWalk`) it walks every state. `noCache` regenerates the traces and reruns every
 * spec check too. `skipTags` are skipped (`@mac` on a local run). `gallerySource` names the run in the records it writes.
 */
export function fullSuites(scripts, { noCache = false, seed, testSeed, skipTags = [], gallerySample, gallerySource } = {}) {
  const apps = scripts['test:browser'] && scripts['test:electron'] ? ['test:browser', 'test:electron'] : ['test:desktop']
  const skip = skipTags.length > 0 ? [`JUNO_SKIP_TAGS=${skipTags.join(',')}`] : []
  const order = testSeed !== undefined ? [`--seed=${testSeed}`] : []
  return [
    { name: 'test', words: ['test', ...order] },
    // The DOM lane (apps/desktop/dom), in the unit job; a commit from before it has no test:dom.
    ...(scripts['test:dom'] ? [{ name: 'test:dom', words: [...skip, 'test:dom', ...order] }] : []),
    { name: 'specs:check', words: [...(noCache ? ['SPECS_CACHE=off'] : []), ...(seed !== undefined ? [`SPECS_SEED=${seed}`] : []), 'specs:check', ...(noCache ? ['--no-cache'] : [])] },
    { name: 'specs:conformance', words: [...(noCache ? ['SPECS_CACHE=off'] : []), 'specs:conformance'] },
    // The real-input walk runs on changed states in affected plans; GALLERY_REAL_WALK=1 forces it by hand.
    { name: 'test:gallery', words: [gallerySample !== undefined && !noCache ? `GALLERY_SAMPLE=${gallerySample}` : 'GALLERY_SHIFT_ALL=1',
      ...(gallerySource ? [`GALLERY_RECORD_SOURCE=${gallerySource}`] : []), 'GALLERY_REAL_WALK=0', 'test:gallery'] },
    ...apps.map((name) => ({ name, words: [...skip, name] })),
  ]
}

/** The gallery's walk counts (apps/gallery/walk-reporter.mjs) from its suite log, for the full-run record. */
export function galleryCounts(log) {
  const line = log.split('\n').findLast((entry) => entry.startsWith('juno-gallery-walk: '))
  return line ? JSON.parse(line.slice('juno-gallery-walk: '.length)) : undefined
}

/** One line for the summary: what the gallery walked, reused and from where, and sampled. */
export function describeGalleryCounts(counts) {
  const line = (what, { walked, reused, sampled, missed }) => {
    const sources = Object.entries(reused).toSorted(([, a], [, b]) => b - a)
    const total = sources.reduce((sum, [, count]) => sum + count, 0)
    return `${what}: ${walked} without a record, ${sampled} sampled, ${total} reused${sources.length ? ` (${sources.map(([from, count]) => `${count} from ${from}`).join(', ')})` : ''}${missed.length ? `; ${missed.length} sampled failed` : ''}`
  }
  const mode = counts.uncached ? 'every state uncached' : counts.sample ? `sample seed ${counts.sample.seed}, ${counts.sample.share * 100}% of reused records` : 'changed states'
  return `Gallery (${mode}). ${line('States', counts.states)}. ${line('Rendering tests', counts.tests)}.`
}
