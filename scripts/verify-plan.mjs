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
 * The suites of a full run. A normal run skips the nightly tier's tests (`@nightly`, scripts/test-areas.mjs) in
 * the DOM and desktop lanes; a nightly run keeps them. `skipTags` are skipped as well (`@mac` on a local run).
 */
export function fullSuites(scripts, { nightly = false, noCache = false, seed, testSeed, skipTags = [] } = {}) {
  const apps = scripts['test:browser'] && scripts['test:electron'] ? ['test:browser', 'test:electron'] : ['test:desktop']
  const skipped = [...skipTags, ...(nightly || !scripts['test:nightly'] ? [] : ['@nightly'])]
  const skip = skipped.length > 0 ? [`JUNO_SKIP_TAGS=${skipped.join(',')}`] : []
  return [
    { name: 'test', words: ['test', ...(testSeed !== undefined ? [`--seed=${testSeed}`] : [])] },
    // The DOM lane (apps/desktop/dom), in the unit job; a commit from before it has no test:dom.
    ...(scripts['test:dom'] ? [{ name: 'test:dom', words: [...skip, 'test:dom', ...(testSeed !== undefined ? [`--seed=${testSeed}`] : [])] }] : []),
    { name: 'specs:check', words: [...(noCache ? ['SPECS_CACHE=off'] : []), ...(seed !== undefined ? [`SPECS_SEED=${seed}`] : []), 'specs:check', ...(noCache ? ['--no-cache'] : [])] },
    { name: 'specs:conformance', words: ['specs:conformance'] },
    { name: 'test:gallery', words: [...(nightly || noCache ? ['GALLERY_SHIFT_ALL=1'] : []), 'test:gallery'] },
    ...apps.map((name) => ({ name, words: [...(nightly ? ['JUNO_COVERAGE=1'] : []), ...skip, name] })),
  ]
}
