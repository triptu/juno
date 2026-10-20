// Keep coordinator failures even when every test step finished successfully.
export function planOutcomes(lines, suites, planned) {
  const results = suites.map((suite, index) => {
    const result = lines.map((line) => /^plan: step (\d+) (\S+) exited with (\d+) after (\d+) s/.exec(line))
      .find((match) => match && Number(match[1]) === index && match[2] === suite.name)
    return { suite: suite.name, code: result ? Number(result[3]) : planned.code || 1, seconds: result ? Number(result[4]) : planned.seconds }
  })
  return planned.code !== 0 && results.every((result) => result.code === 0) ? [...results, { ...planned, suite: 'plan' }] : results
}
