// Local feedback only. Passing Bun results never populate the TypeScript cache.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-5'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const bun = join(dirname(require.resolve('bun/package.json')), 'bin/bun.exe')
const version = require('bun/package.json').version
const parity = process.argv.includes('--parity')
const noCache = parity || process.argv.includes('--no-cache')
const cache = join(tmpdir(), 'juno-cache', 'typecheck-bun')
const listed = spawnSync(process.execPath, [join(root, 'scripts/typecheck.mjs'), '--projects-json'], { cwd: root, encoding: 'utf8' })
if (listed.status !== 0) throw new Error(listed.stderr || 'Could not list TypeScript projects')
const projects = JSON.parse(listed.stdout)
const runnerHash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(join(root, 'scripts/typecheck.mjs'))).digest('hex')

// Resolve inheritance with the TS 5 parser already used by repository tools.
// References must also be supported because Bun follows them in build mode.
function unsupported(config, seen = new Set()) {
  if (seen.has(config)) return undefined
  seen.add(config)
  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
  if (!parsed || parsed.errors.length) return 'config requires TypeScript diagnostics'
  const options = parsed.options
  if (options.plugins?.length) return 'plugins'
  if (!options.noEmit || options.declaration || options.emitDeclarationOnly || options.composite) return 'emit or composite build'
  for (const reference of parsed.projectReferences ?? []) {
    const reason = unsupported(ts.resolveProjectReferencePath(reference), seen)
    if (reason) return reason
  }
  return undefined
}

for (const project of projects) {
  project.path = join(root, project.cwd, project.config)
  project.reason = unsupported(project.path)
  project.bunKey = createHash('sha256').update(`${version}\0${runnerHash}\0${project.key}`).digest('hex')
}
const pending = projects.filter((project) => noCache || (project.reason ? !project.tscPassed : !existsSync(join(cache, project.bunKey))))
const local = pending.filter((project) => !project.reason)
const fallback = pending.filter((project) => project.reason)
if (process.argv.includes('--pending')) {
  console.log(JSON.stringify({ bun: local.map((project) => project.label), tsc: fallback.map((project) => ({ label: project.label, config: `${project.cwd}/${project.config}`, reason: project.reason })) }))
  process.exit(0)
}

console.log(`typecheck:bun: ${local.length} local project(s), ${fallback.length} need TypeScript, ${projects.length - pending.length} cached`)
if (fallback.length) {
  console.log('TypeScript fallback is scheduled by pnpm affected.')
  if (parity) throw new Error('Parity requires Bun-compatible configs for every project')
}
if (!local.length) process.exit(0)
const work = mkdtempSync(join(tmpdir(), 'juno-bun-check-'))
const solution = join(work, 'tsconfig.json')
writeFileSync(solution, JSON.stringify({ files: [], references: local.map((project) => ({ path: project.path })) }))
const started = Date.now()
try {
  // Plain tsc-style file(line,column) diagnostics are clickable in VS Code.
  const result = spawnSync(bun, ['check', '-b', solution, '--no-pretty', '--all'], { cwd: root, ...(parity ? { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 } : { stdio: 'inherit' }) })
  if (parity) {
    const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
    const authority = spawnSync(process.execPath, [tsc, '-b', solution, '--force', '--pretty', 'false'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    if (result.error || authority.error) throw result.error ?? authority.error
    const bunErrors = diagnostics(result.stdout + result.stderr)
    const tscErrors = diagnostics(authority.stdout + authority.stderr)
    const onlyBun = bunErrors.filter((error) => !tscErrors.includes(error))
    const onlyTsc = tscErrors.filter((error) => !bunErrors.includes(error))
    const failedWithoutErrors = [result, authority].some((run) => run.status !== 0 && diagnostics(run.stdout + run.stderr).length === 0)
    const mismatch = failedWithoutErrors || (result.status === 0) !== (authority.status === 0) || onlyBun.length > 0 || onlyTsc.length > 0
    if (mismatch) {
      console.error('Only Bun:', onlyBun, '\nOnly TypeScript:', onlyTsc)
      if (failedWithoutErrors) console.error(result.stdout, result.stderr, authority.stdout, authority.stderr)
    }
    console.log(`typecheck:parity: ${mismatch ? 'FAILED' : 'matched'} (${bunErrors.length} Bun, ${tscErrors.length} TypeScript diagnostics) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
    process.exitCode = mismatch ? 1 : 0
  } else {
    if (result.error) throw result.error
    if (result.status === 0 && !noCache) {
      mkdirSync(cache, { recursive: true })
      for (const project of local) writeFileSync(join(cache, project.bunKey), `${project.label}\n`)
    }
    console.log(`typecheck:bun: ${result.status === 0 ? 'passed' : 'failed'} in ${((Date.now() - started) / 1000).toFixed(1)} s`)
    process.exitCode = result.status ?? 1
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

// Compare unique diagnostics, including message continuations; ignore timing and
// repeated reports of an imported file from several projects.
function diagnostics(output) {
  const errors = []
  for (const line of output.replaceAll(root + '/', '').split('\n')) {
    if (/^(?:.+\(\d+,\d+\): |)error TS\d+:/.test(line)) errors.push(line.trim())
    else if (/^\s+\S/.test(line) && errors.length) errors[errors.length - 1] += ` ${line.trim()}`
  }
  return [...new Set(errors)].toSorted()
}
