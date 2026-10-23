// Runs each workspace package's tests, at most `jobs` packages at a time.
// With --files, runs only those files, each in its own package.
import { spawn } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unitTestMatcher } from './affected-tests.mjs'
import { forwardSignals } from './remote/children.mjs'

export function unitCommands(args, root) {
  if (args[0] !== '--files') {
    const { workspaces } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const dirs = globSync(workspaces.map((pattern) => `${pattern}/package.json`), { cwd: root }).map((file) => file.slice(0, -'/package.json'.length)).toSorted()
    return dirs.filter((dir) => JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')).scripts?.test).map((dir) => ['run', '--cwd', dir, 'test', ...args])
  }
  if (args.length === 1) throw new Error('--files needs at least one repository test path')
  const matches = unitTestMatcher(root)
  const packages = new Map()
  for (const file of new Set(args.slice(1))) {
    if (file.split('/').some((part) => part === '..' || part === '.') || !matches(file) || !existsSync(resolve(root, file))) throw new Error(`Not a unit test file: ${file}`)
    const dir = file.split('/').slice(0, 2).join('/')
    if (!packages.has(dir)) packages.set(dir, [])
    packages.get(dir).push(resolve(root, file))
  }
  const candidates = [...globSync([...packages.keys()].map((dir) => `${dir}/**/*`), { cwd: root, exclude: ['**/node_modules/**'] })].filter(matches).map((file) => resolve(root, file))
  return [...packages].map(([dir, files]) => {
    // Vitest's filename filters use substrings, even for absolute paths.
    // Exclude namesakes in nested folders and files with a longer extension.
    const prefix = resolve(root, dir) + '/'
    const filters = files.map((file) => file.slice(prefix.length).toLowerCase())
    const extra = candidates.filter((file) => file.startsWith(prefix) && !files.includes(file) && filters.some((filter) => file.slice(prefix.length).toLowerCase().includes(filter)))
    return ['run', '--cwd', dir, 'test', ...files, ...extra.flatMap((file) => ['--exclude', file.slice(prefix.length)])]
  })
}

if (import.meta.main) {
  const jobs = Number(process.env.JUNO_TEST_PACKAGE_JOBS ?? 2)
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error('JUNO_TEST_PACKAGE_JOBS must be a positive integer')
  const args = process.argv.slice(2)
  const commands = unitCommands(args, process.cwd())
  const children = new Set()
  forwardSignals(children)
  let cancelled = false
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = true })
  const run = (command) => new Promise((done) => {
    const child = spawn('bun', command, { stdio: 'inherit' })
    children.add(child)
    child.on('error', (error) => console.error(error.message))
    child.on('close', (code) => { children.delete(child); done(code ?? 1) })
  })
  const codes = await Promise.all(Array.from({ length: Math.min(jobs, commands.length) }, async () => {
    let result = 0
    while (commands.length) {
      if (cancelled) break
      const code = await run(commands.shift())
      result ||= code
    }
    return result
  }))
  process.exitCode = cancelled ? 130 : codes.find((code) => code !== 0) ?? 0
}
