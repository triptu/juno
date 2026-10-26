// Keep coordinator failures even when every test step finished successfully.
export function planOutcomes(lines, suites, planned) {
  const results = suites.map((suite, index) => {
    const result = lines.map((line) => /^plan: step (\d+) (\S+) exited with (\d+)(?: after (\d+) s)?/.exec(line))
      .find((match) => match && Number(match[1]) === index && match[2] === suite.name)
    return { suite: suite.name, code: result ? Number(result[3]) : planned.code || 1, seconds: result?.[4] ? Number(result[4]) : planned.seconds, unfinished: !result || !result[4] }
  })
  return planned.code !== 0 && results.every((result) => result.code === 0) ? [...results, { ...planned, suite: 'plan' }] : results
}

/**
 * The suites of a full run: every test, including the @heavy ones (scripts/test-areas.mjs). Conformance replays its
 * traces uncached and the gallery checks every state with the fast check; the spec check reuses unchanged checks, as
 * it proves the models, not Juno's code. `noCache` reruns every spec check too. `skipTags` are skipped (`@mac` on a
 * local run).
 */
export function fullSuites(scripts, { noCache = false, seed, testSeed, skipTags = [] } = {}) {
  const apps = scripts['test:browser'] && scripts['test:electron'] ? ['test:browser', 'test:electron'] : ['test:desktop']
  const skip = skipTags.length > 0 ? [`JUNO_SKIP_TAGS=${skipTags.join(',')}`] : []
  const order = testSeed !== undefined ? [`--seed=${testSeed}`] : []
  return [
    { name: 'test', words: ['test', ...order] },
    // The DOM lane (apps/desktop/dom), in the unit job; a commit from before it has no test:dom.
    ...(scripts['test:dom'] ? [{ name: 'test:dom', words: [...skip, 'test:dom', ...order] }] : []),
    { name: 'specs:check', words: [...(noCache ? ['SPECS_CACHE=off'] : []), ...(seed !== undefined ? [`SPECS_SEED=${seed}`] : []), 'specs:check', ...(noCache ? ['--no-cache'] : [])] },
    { name: 'specs:conformance', words: ['SPECS_CACHE=off', 'specs:conformance'] },
    // The real-input walk runs on changed states in affected plans; GALLERY_REAL_WALK=1 forces it by hand.
    { name: 'test:gallery', words: ['GALLERY_SHIFT_ALL=1', 'GALLERY_REAL_WALK=0', 'test:gallery'] },
    ...apps.map((name) => ({ name, words: [...skip, name] })),
  ]
}
