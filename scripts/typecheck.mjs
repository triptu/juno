// Typechecks every TypeScript project, skipping the ones whose inputs passed before.
//
//   pnpm typecheck                every project (unchanged ones are skipped)
//   pnpm typecheck --no-cache     check them all
//   node scripts/typecheck.mjs --pending   list the projects that would run
//
// The projects are each package's `tsc -p <config>` from its typecheck script,
// plus scripts/tsconfig.json; the tsconfigs, and so the rules, are unchanged.
// Packages ship TypeScript source, so a project also checks the source of every
// workspace package it depends on. A project's key is a hash of its package's
// files, the files of every workspace package it depends on (directly or not),
// the tsconfig chain, the lockfile and the TypeScript version. A passing key is
// recorded in the system temp folder (juno-cache/typecheck), shared by every
// worktree and brought back from pnpm remote, and is skipped the next time.
//
// A project that does run uses tsc --incremental with its .tsbuildinfo in the
// package's node_modules/.cache, so files that did not change are not checked
// again. At most JUNO_TYPECHECK_JOBS (default 2) tsc processes run at once in
// this run, and at most two at once on this Mac, through the heavy-job lock's
// separate `typecheck` queue.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const useCache = !process.argv.includes('--no-cache')
const jobs = Math.max(1, Number(process.env.JUNO_TYPECHECK_JOBS ?? 2))
const cacheDir = process.env.JUNO_TYPECHECK_CACHE_DIR ?? join(tmpdir(), 'juno-cache', 'typecheck')
// TypeScript 7's package exports no bin path; bin/tsc hands over to the native compiler for this platform.
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const tsVersion = require('typescript/package.json').version

/** Every file under a directory that a typecheck can read, without build output or dependencies. */
const skip = new Set(['node_modules', 'out', 'dist', 'release', '.vite', 'coverage', 'test-results', 'playwright-report', 'feel-report', 'shots', '.juno-status', '.remote'])
function filesUnder(dir) {
  const found = []
  const walk = (path) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.npmrc') continue
      const child = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(child)
      } else if (entry.isFile() && !entry.name.endsWith('.tsbuildinfo')) found.push(child)
    }
  }
  walk(dir)
  return found
}

// Workspace packages, their dependencies on each other, and their tsc projects.
const workspace = new Map()
for (const parent of ['apps', 'packages', 'docs/juno-agent']) {
  if (!existsSync(join(root, parent))) continue
  for (const name of readdirSync(join(root, parent))) {
    const dir = `${parent}/${name}`
    if (!existsSync(join(root, dir, 'package.json'))) continue
    const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
    const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies })
    const configs = [...(manifest.scripts?.typecheck ?? '').matchAll(/tsc -p (\S+)/g)].map((match) => match[1])
    workspace.set(manifest.name, { dir, deps, configs })
  }
}
const reach = (name, seen = new Set()) => {
  if (seen.has(name) || !workspace.has(name)) return seen
  seen.add(name)
  for (const dep of workspace.get(name).deps) reach(dep, seen)
  return seen
}

/** A tsconfig and every config it extends inside the repo. */
function configChain(config) {
  const chain = []
  for (let path = config; path && existsSync(join(root, path)) && !chain.includes(path); ) {
    chain.push(path)
    const extended = /"extends"\s*:\s*"([^"]+)"/.exec(readFileSync(join(root, path), 'utf8'))?.[1]
    path = extended?.startsWith('.') ? relative(root, resolve(root, dirname(path), extended)) : undefined
  }
  return chain
}

const fileHash = new Map()
const hashOf = (file) => {
  if (!fileHash.has(file)) fileHash.set(file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex'))
  return fileHash.get(file)
}
const dirFiles = new Map()
const filesOf = (dir) => {
  if (!dirFiles.has(dir)) dirFiles.set(dir, filesUnder(dir))
  return dirFiles.get(dir)
}

const projects = []
for (const [name, { dir, configs }] of workspace) {
  for (const config of configs) {
    const inputs = [...reach(name)].flatMap((pkg) => filesOf(workspace.get(pkg).dir))
    // `config` is relative to the package, where tsc runs.
    projects.push({ label: `${name} ${config}`, cwd: dir, config, inputs: [...inputs, ...configChain(`${dir}/${config}`)] })
  }
}
if (existsSync(join(root, 'scripts/tsconfig.json'))) {
  const scripts = filesOf('scripts').filter((file) => /\.(ts|mts)$/.test(file))
  // The live scripts import the Slack and sync packages; they are root devDependencies.
  const rootDeps = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies ?? {})
  const deps = [...new Set(rootDeps.flatMap((dep) => [...reach(dep)]))].flatMap((pkg) => filesOf(workspace.get(pkg).dir))
  projects.push({ label: 'scripts tsconfig.json', cwd: '.', config: 'scripts/tsconfig.json', inputs: [...scripts, ...deps, ...configChain('scripts/tsconfig.json')] })
}

const shared = ['pnpm-lock.yaml', 'tsconfig.base.json']
for (const project of projects) {
  const hash = createHash('sha256').update(`${tsVersion}\0${project.label}\0`)
  for (const file of [...new Set([...shared, ...project.inputs])].toSorted()) if (existsSync(join(root, file))) hash.update(`${file}\0${hashOf(file)}\0`)
  project.key = hash.digest('hex')
}

const started = Date.now()
// Expose this exact inventory and its input keys to the local Bun checker.
if (process.argv.includes('--projects-json')) {
  console.log(JSON.stringify(projects.map(({ label, cwd, config, key }) => ({ label, cwd, config, key, tscPassed: existsSync(join(cacheDir, key)) }))))
  process.exit(0)
}
const selectedAt = process.argv.indexOf('--projects')
const selected = selectedAt < 0 ? undefined : JSON.parse(process.argv[selectedAt + 1])
if (selected && selected.some((path) => !projects.some((project) => `${project.cwd}/${project.config}` === path))) throw new Error('Unknown typecheck project')
const pending = projects.filter((project) => (!selected || selected.includes(`${project.cwd}/${project.config}`)) && !(useCache && existsSync(join(cacheDir, project.key))))
// --pending prints the projects that would run, as JSON, for pnpm affected.
if (process.argv.includes('--pending')) {
  console.log(JSON.stringify(pending.map((project) => project.label)))
  process.exit(0)
}
console.log(`typecheck: ${projects.length} projects, ${projects.length - pending.length} unchanged since they last passed${pending.length ? `, checking ${pending.length}` : ''}`)

/** Runs one project's tsc, through the Mac-wide typecheck queue unless this machine is ours alone. */
function check(project) {
  return new Promise((resolvePromise) => {
    const buildInfo = join(root, project.cwd, 'node_modules/.cache/tsc', `${project.config.replace(/\W/g, '_')}.tsbuildinfo`)
    mkdirSync(dirname(buildInfo), { recursive: true })
    const args = selected
      ? [tsc, '-b', project.config, '--pretty', 'false']
      : [tsc, '-p', project.config, '--incremental', '--tsBuildInfoFile', buildInfo]
    const command = process.env.JUNO_HEAVY_SLOTS === '1' ? [process.execPath, args] : [process.execPath, [join(root, 'scripts/heavy.mjs'), '--queue', 'typecheck', process.execPath, ...args]]
    const begun = Date.now()
    const child = spawn(command[0], command[1], { cwd: join(root, project.cwd), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (code) => resolvePromise({ project, code: code ?? 1, output, seconds: (Date.now() - begun) / 1000 }))
  })
}

const queue = [...pending]
const results = []
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length > 0) {
      const result = await check(queue.shift())
      results.push(result)
      console.log(`  ${result.code === 0 ? 'ok    ' : 'FAILED'} ${result.project.label} (${result.seconds.toFixed(1)} s)`)
      if (result.code !== 0) process.stdout.write(`${result.output.trimEnd().replace(/^/gm, '    ')}\n`)
      else if (useCache) {
        mkdirSync(cacheDir, { recursive: true })
        writeFileSync(join(cacheDir, result.project.key), `${result.project.label}\n`)
      }
    }
  }),
)
const failed = results.filter((result) => result.code !== 0)
console.log(`typecheck: ${failed.length ? `${failed.length} project(s) failed` : 'passed'} in ${((Date.now() - started) / 1000).toFixed(1)} s`)
process.exit(failed.length ? 1 : 0)
