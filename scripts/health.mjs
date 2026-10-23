import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { healthBaseline, healthRegressions } from './health-ratchet.mjs'
import { collectSizeReport } from './health-size.mjs'
import { runTool } from './health-run.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.juno-status')
const started = Date.now()
const errors = []
const location = (file) => ({ file: relative(root, file.name), line: file.start, end: file.end })

function run(tool, args, runtime = process.execPath) {
  const manifestPath = resolve(root, 'node_modules', tool, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[tool]
  return runTool(tool, runtime, [resolve(dirname(manifestPath), bin), ...args], { cwd: root, env: { ...process.env, NO_COLOR: '1' } })
}

async function check(name, action) {
  try { return await action() } catch (error) {
    errors.push({ tool: name, message: error.message, ...(error.timedOut ? { timedOut: true } : {}) })
    return null
  }
}

async function main() {
  mkdirSync(output, { recursive: true })
  const knipRun = check('knip', async () => {
    rmSync(resolve(output, 'knip-report.json'), { force: true })
    // Knip runs on Node: it asks the runtime which imports are built in, and Bun
    // counts `ws` and `undici`, so their dependencies would look unused.
    const raw = await run('knip', ['--config', 'knip.config.mjs', '--reporter', 'json', '--no-progress', '--no-exit-code'], 'node')
    const report = JSON.parse(raw)
    writeFileSync(resolve(output, 'knip-report.json'), raw)
    const findings = report.issues.flatMap(({ file, ...categories }) => Object.entries(categories)
      .flatMap(([kind, items]) => items.map((item) => ({ file, kind, ...item }))))
    const count = (...kinds) => findings.filter((item) => kinds.includes(item.kind)).length
    return { unusedFiles: count('files'), unusedExports: count('exports', 'nsExports'),
      unusedTypes: count('types', 'nsTypes'), unusedDependencies: count('dependencies', 'devDependencies', 'optionalPeerDependencies'),
      unlistedDependencies: count('unlisted'), findings }
  })
  const cloneRun = check('jscpd', async () => {
    const reportPath = resolve(output, 'jscpd-report.json')
    rmSync(reportPath, { force: true })
    const paths = ['packages', 'apps'].flatMap((base) => readdirSync(resolve(root, base), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => `${base}/${entry.name}/src`))
    await run('jscpd', ['--config', '.jscpd.json', '--workers', '2', '--absolute', ...paths])
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    const clones = report.duplicates.map((clone) => ({ first: location(clone.firstFile), second: location(clone.secondFile),
      lines: clone.lines, tokens: clone.tokens })).toSorted((a, b) => b.tokens - a.tokens || a.first.file.localeCompare(b.first.file))
    return { percentage: report.statistics.total.percentage, clonedLines: report.statistics.total.duplicatedLines,
      scannedFiles: report.statistics.total.sources, clonePairs: clones.length, topClonePairs: clones.slice(0, 5) }
  })
  const [knip, duplication, size] = await Promise.all([knipRun, cloneRun, check('size', collectSizeReport)])
  const report = { schemaVersion: 1, timestamp: new Date().toISOString(), mode: process.argv.includes('--check') ? 'check' : 'report-only',
    durationMs: Date.now() - started, complete: errors.length === 0,
    counts: { unusedFiles: knip?.unusedFiles ?? null, unusedExports: knip?.unusedExports ?? null,
      unusedTypes: knip?.unusedTypes ?? null, unusedDependencies: knip?.unusedDependencies ?? null,
      unlistedDependencies: knip?.unlistedDependencies ?? null, clonePairs: duplication?.clonePairs ?? null,
      oversizedFiles: size?.oversizedFiles.length ?? null, oversizedFunctions: size?.oversizedFunctions.length ?? null },
    topOffenders: { unused: knip?.findings.slice(0, 5) ?? [], clones: duplication?.topClonePairs ?? [],
      files: size?.oversizedFiles.slice(0, 5) ?? [], functions: size?.oversizedFunctions.slice(0, 5) ?? [] },
    knip, duplication, size, errors }
  const temporary = resolve(output, `health.${process.pid}.json`)
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n')
  renameSync(temporary, resolve(output, 'health.json'))

  console.log(`Codebase health (${report.mode})`)
  if (knip) console.log(`Knip: ${knip.unusedFiles} unused files, ${knip.unusedExports} unused exports, ${knip.unusedTypes} unused types, ${knip.unusedDependencies} unused dependencies, ${knip.unlistedDependencies} unlisted dependencies`)
  if (duplication) {
    console.log(`Duplication: ${duplication.percentage.toFixed(2)}% of source lines, ${duplication.clonePairs} clone pairs`)
    for (const pair of duplication.topClonePairs) console.log(`  ${pair.first.file}:${pair.first.line} ~ ${pair.second.file}:${pair.second.line} (${pair.lines} lines, ${pair.tokens} tokens)`)
  }
  if (size) {
    console.log(`Size: ${size.oversizedFiles.length} files over ${size.fileLimit} lines, ${size.oversizedFunctions.length} functions over ${size.functionLimit} lines`)
    for (const item of size.oversizedFiles.slice(0, 5)) console.log(`  ${item.file}: ${item.lines} lines`)
    for (const item of size.oversizedFunctions.slice(0, 5)) console.log(`  ${item.file}:${item.line} ${item.name}: ${item.lines} lines`)
  }
  for (const error of errors) console.warn(error.timedOut ? `  ${error.message}` : `  ${error.tool} report unavailable: ${error.message}`)
  console.log(`Report: .juno-status/health.json (${(report.durationMs / 1000).toFixed(1)}s)`)
  if (!report.complete) process.exitCode = 1
  if (process.argv.includes('--update-baseline')) {
    const baseline = healthBaseline(report)
    writeFileSync(resolve(root, 'health-baseline.json'), JSON.stringify(baseline, null, 2) + '\n')
    console.log('Updated health-baseline.json; review and commit the change')
  } else if (process.argv.includes('--check')) {
    const baseline = JSON.parse(readFileSync(resolve(root, 'health-baseline.json'), 'utf8'))
    const failures = healthRegressions(report, baseline)
    for (const failure of failures) console.error(report.complete ? `Health regression: ${failure}` : failure)
    if (failures.length) process.exitCode = 1
  }

}

try { await main() } catch (error) {
  console.error(`Health check failed: ${error.message}`)
  process.exitCode = 1
}
