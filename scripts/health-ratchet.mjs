const countKeys = ['unusedFiles', 'unusedExports', 'unusedTypes', 'unusedDependencies',
  'unlistedDependencies', 'clonePairs', 'oversizedFiles', 'oversizedFunctions']

export function healthBaseline(report) {
  if (!report.complete) throw new Error('Cannot baseline an incomplete health report')
  return {
    schemaVersion: 1,
    recordedOn: report.timestamp.slice(0, 10),
    counts: report.counts,
    clonedLines: report.duplication.clonedLines,
    oversizedFiles: report.size.oversizedFiles.map(({ file }) => file).toSorted(),
    oversizedFunctions: report.size.oversizedFunctions.map(({ file, id }) => `${file}:${id}`).toSorted(),
  }
}

export function healthRegressions(report, baseline) {
  if (!report.complete) {
    const late = (report.errors ?? []).filter((error) => error.timedOut).map((error) => error.tool)
    if (late.length && late.length === report.errors.length) return [`Health tools timed out (${late.join(', ')}); no finding was checked. Run bun run lint again when the machine is less busy`]
    return ['Health tools failed; fix the report errors before checking the baseline']
  }
  if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.oversizedFiles)
    || !Array.isArray(baseline.oversizedFunctions)) throw new Error('Invalid health baseline')
  const failures = []
  for (const key of countKeys) {
    const before = baseline.counts?.[key]
    const after = report.counts[key]
    if (!Number.isInteger(before) || before < 0 || !Number.isInteger(after) || after < 0) {
      throw new Error(`Invalid health count: ${key}`)
    }
    if (after > before) failures.push(`${key}: ${before} → ${after}`)
  }
  if (!Number.isInteger(baseline.clonedLines) || baseline.clonedLines < 0) throw new Error('Invalid clonedLines baseline')
  if (report.duplication.clonedLines > baseline.clonedLines) {
    failures.push(`clonedLines: ${baseline.clonedLines} → ${report.duplication.clonedLines}`)
  }
  const files = new Set(baseline.oversizedFiles)
  const functions = new Set(baseline.oversizedFunctions)
  for (const item of report.size.oversizedFiles) {
    if (!files.has(item.file)) failures.push(`New file over ${report.size.fileLimit} lines: ${item.file}`)
  }
  for (const item of report.size.oversizedFunctions) {
    if (!functions.has(`${item.file}:${item.id}`)) {
      failures.push(`New function over ${report.size.functionLimit} lines: ${item.file}:${item.line} ${item.id}`)
    }
  }
  return failures
}
