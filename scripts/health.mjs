import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectSizeReport } from './health-size.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.juno-status')
const started = Date.now()
const errors = []
const location = (file) => ({ file: relative(root, file.name), line: file.start, end: file.end })

function run(tool, args) {
  const manifestPath = resolve(root, 'node_modules', tool, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[tool]
  const result = spawnSync(process.execPath, [resolve(dirname(manifestPath), bin), ...args], {
    cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024,
    detached: process.platform !== 'win32',
    env: { ...process.env, NO_COLOR: '1' },
  })
  if (result.error && result.pid && process.platform !== 'win32') {
    // The jscpd launcher starts a native child. A timeout must stop that child too.
    try { process.kill(-result.pid, 'SIGKILL') } catch { /* Already exited. */ }
  }
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `${tool} exited ${result.status}: ${result.stderr.trim()}`)
  return result.stdout
}

function check(name, action) {
  try { return action() } catch (error) {
    errors.push({ tool: name, message: error.message })
    return null
  }
}

function main() {
  mkdirSync(output, { recursive: true })
  const knip = check('knip', () => {
    rmSync(resolve(output, 'knip-report.json'), { force: true })
    const raw = run('knip', ['--config', 'knip.config.mjs', '--reporter', 'json', '--no-progress', '--no-exit-code'])
    const report = JSON.parse(raw)
    writeFileSync(resolve(output, 'knip-report.json'), raw)
    const findings = report.issues.flatMap(({ file, ...categories }) => Object.entries(categories)
      .flatMap(([kind, items]) => items.map((item) => ({ file, kind, ...item }))))
    const count = (...kinds) => findings.filter((item) => kinds.includes(item.kind)).length
    return { unusedFiles: count('files'), unusedExports: count('exports', 'nsExports'),
      unusedTypes: count('types', 'nsTypes'), unusedDependencies: count('dependencies', 'devDependencies', 'optionalPeerDependencies'),
      unlistedDependencies: count('unlisted'), findings }
  })
  const duplication = check('jscpd', () => {
    const reportPath = resolve(output, 'jscpd-report.json')
    rmSync(reportPath, { force: true })
    const paths = ['packages', 'apps'].flatMap((base) => readdirSync(resolve(root, base), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => `${base}/${entry.name}/src`))
    run('jscpd', ['--config', '.jscpd.json', '--workers', '2', '--absolute', ...paths])
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    const clones = report.duplicates.map((clone) => ({ first: location(clone.firstFile), second: location(clone.secondFile),
      lines: clone.lines, tokens: clone.tokens })).toSorted((a, b) => b.tokens - a.tokens || a.first.file.localeCompare(b.first.file))
    return { percentage: report.statistics.total.percentage, clonedLines: report.statistics.total.duplicatedLines,
      scannedFiles: report.statistics.total.sources, clonePairs: clones.length, topClonePairs: clones.slice(0, 5) }
  })
  const size = check('size', collectSizeReport)
  const report = { schemaVersion: 1, timestamp: new Date().toISOString(), mode: 'report-only',
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

  console.log('Codebase health (report only)')
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
  for (const error of errors) console.warn(`  ${error.tool} report unavailable: ${error.message}`)
  console.log(`Report: .juno-status/health.json (${(report.durationMs / 1000).toFixed(1)}s)`)
}

// Findings and tool failures stay advisory until the maintenance pass is complete.
try { main() } catch (error) { console.error(`Health report unavailable: ${error.message}`) }
