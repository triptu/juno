// Merge a batch locally. Only --push permits publishing to origin/main.
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(root, '.juno-status/batches')
const generated = ['health-baseline.json', 'docs/decision-log.md']
const argv = process.argv.slice(2)
const push = argv.includes('--push')
const dryRun = argv.includes('--dry-run')
let state
let statePath
let logPath

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.error?.message ?? result.stderr}`)
  return result.stdout.trimEnd()
}

function save() {
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2) + '\n')
  renameSync(`${statePath}.tmp`, statePath)
}

function run(command, args) {
  console.log(`${command} ${args.join(' ')} (log: ${logPath})`)
  const fd = openSync(logPath, 'a')
  let result
  try {
    writeFileSync(fd, `\n$ ${command} ${args.join(' ')}\n`)
    result = spawnSync(command, args, { cwd: state.worktree, stdio: ['ignore', fd, fd], env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no' } })
  } finally { closeSync(fd) }
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.error?.message ?? result.status}); see ${logPath}`)
}

function clean() {
  if (git(state.worktree, 'status', '--porcelain')) throw new Error('Worktree has uncommitted changes; resolve and commit them before continuing')
}

function conflicts() {
  return git(state.worktree, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean)
}

function mergeHead() {
  const path = git(state.worktree, 'rev-parse', '--git-path', 'MERGE_HEAD')
  return existsSync(resolve(state.worktree, path)) ? readFileSync(resolve(state.worktree, path), 'utf8').trim() : undefined
}

function ancestor(commit, descendant = 'HEAD') {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, descendant], { cwd: state.worktree })
  if (result.status !== 0 && result.status !== 1) throw new Error('Could not check merge ancestry')
  return result.status === 0
}

function finishPending() {
  const branch = state.branches[state.next]
  const pending = mergeHead()
  if (pending) {
    if (pending !== branch.commit) throw new Error('The pending merge is not the recorded batch branch')
    // Keep a temporary copy; both generated files are rebuilt after all merges.
    for (const file of conflicts().filter((path) => generated.includes(path))) {
      git(state.worktree, 'checkout', 'HEAD', '--', file)
    }
    const unresolved = conflicts()
    if (unresolved.length) throw new Error(`Conflict merging ${branch.name}:\n${unresolved.map((file) => `  ${file}`).join('\n')}\nResolve and git add these files in ${state.worktree}, then use --continue ${state.name}`)
    run('git', ['commit', '--no-edit'])
  }
  if (!ancestor(branch.commit)) throw new Error(`Merge of ${branch.name} was aborted or did not finish; merge ${branch.commit} in ${state.worktree}, then continue`)
  state.next++
  state.pending = false
  save()
}

function mergeBranches() {
  if (state.pending) finishPending()
  clean()
  while (state.next < state.branches.length) {
    const branch = state.branches[state.next]
    state.pending = true
    save()
    try {
      run('git', ['merge', '--no-ff', '--no-edit', '-m', `Merge ${branch.name}`, branch.commit])
    } catch (error) {
      if (!mergeHead()) throw error
    }
    finishPending()
  }
}

function create(branches) {
  if (!branches.length) throw new Error('Provide at least one local branch')
  const pinned = branches.map((name) => {
    git(root, 'check-ref-format', '--branch', name)
    return { name, commit: git(root, 'rev-parse', '--verify', `refs/heads/${name}^{commit}`) }
  })
  const base = git(root, 'rev-parse', '--verify', 'refs/remotes/origin/main^{commit}')
  const refs = new Set(git(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/batch-*').split('\n'))
  let n = 1
  while (refs.has(`batch-${n}`) || existsSync(resolve(directory, `batch-${n}.json`)) || existsSync(resolve(root, `.claude/worktrees/batch-${n}`))) n++
  const name = `batch-${n}`
  statePath = resolve(directory, `${name}.json`)
  state = { name, base, branches: pinned, next: 0, pending: false, dryRun, worktree: resolve(root, `.claude/worktrees/${name}`) }
  git(root, 'worktree', 'add', '-b', name, state.worktree, base)
  save()
}

function regenerate() {
  run('pnpm', ['install', '--frozen-lockfile'])
  run(process.execPath, ['scripts/decision-log.mjs'])
  run('pnpm', ['health:baseline'])
  git(state.worktree, 'add', '--', ...generated)
  if (git(state.worktree, 'diff', '--cached', '--name-only')) {
    run('git', ['commit', '-m', 'Regenerate batch decision log and health baseline'])
  }
  clean()
}

function checkMessages() {
  const messages = git(state.worktree, 'log', `${state.base}..HEAD`, '--format=%H%n%B%x00')
  // Reject attribution trailers and common generated/assisted-by signatures.
  const attribution = /^\s*(?:co-authored-by\s*:|(?:.*\b)?(?:generated|written|authored|assisted|powered|created)\s+(?:with|by|using)\b.*\b(?:ai|claude|codex|chatgpt|openai|copilot|gemini|anthropic)\b|(?:ai[- ](?:attribution|generated|assisted)|(?:claude|codex|chatgpt|copilot))\s*:)/im
  if (attribution.test(messages)) throw new Error('Batch contains a commit attribution line; remove it before publishing')
}

function publish(checkedHead) {
  clean()
  if (git(state.worktree, 'rev-parse', 'HEAD') !== checkedHead) throw new Error('HEAD changed during checks; continue to check again')
  git(state.worktree, 'fetch', 'origin', 'main')
  if (git(state.worktree, 'rev-parse', 'origin/main') !== state.base) {
    throw new Error('origin/main moved since this batch started; create a new batch against the updated origin/main')
  }
  checkMessages()
  // A normal push rejects a concurrent, non-fast-forward update of main.
  run('git', ['push', 'origin', `${checkedHead}:refs/heads/main`])
  state.pushed = checkedHead
  save()
  cleanup()
}

function cleanup() {
  git(root, 'worktree', 'remove', state.worktree)
  console.log(`Pushed ${state.name}; removed ${state.worktree}. Log: ${logPath}`)
}

function main() {
  if (argv.includes('--help')) {
    console.log('node scripts/batch-merge.mjs [--dry-run | --push] branch...\nnode scripts/batch-merge.mjs --continue batch-N [--push]\nChecks are typecheck, lint and the unit tests. Dry run merges and regenerates locally, runs no checks and cannot push.')
    return
  }
  if (push && dryRun) throw new Error('--dry-run cannot be combined with --push')
  const unknown = argv.find((arg) => arg.startsWith('-') && !['--push', '--dry-run', '--continue'].includes(arg))
  if (unknown) throw new Error(`Unknown option: ${unknown}`)
  mkdirSync(directory, { recursive: true })
  const lock = resolve(directory, 'active.lock')
  let fd
  try { fd = openSync(lock, 'wx') } catch { throw new Error(`Another batch command holds ${lock}; remove it only if that process has stopped`) }
  try {
    writeFileSync(fd, `${process.pid}\n`)
    const positional = argv.filter((arg) => !arg.startsWith('--'))
    if (argv.includes('--continue')) {
      if (positional.length !== 1 || !/^batch-\d+$/.test(positional[0])) throw new Error('--continue needs one batch-N name')
      statePath = resolve(directory, `${positional[0]}.json`)
      state = JSON.parse(readFileSync(statePath, 'utf8'))
      if (push && state.dryRun) throw new Error('Dry-run batches cannot push; start a new batch without --dry-run')
    } else create(positional)
    logPath = resolve(directory, `${state.name}.log`)
    console.log(`Batch: ${state.name}\nWorktree: ${state.worktree}\nResume: node scripts/batch-merge.mjs --continue ${state.name}`)
    if (state.pushed) { cleanup(); return }
    if (git(state.worktree, 'branch', '--show-current') !== state.name) throw new Error('Batch worktree is on a different branch')
    if (!ancestor(state.base)) throw new Error('Batch no longer contains its original base')
    if (state.next < state.branches.length) mergeBranches()
    else {
      const changed = git(state.worktree, 'status', '--porcelain').split('\n').filter(Boolean)
      if (changed.some((line) => !generated.includes(line.slice(3)))) {
        throw new Error('Commit changes outside the generated files before continuing')
      }
    }
    for (const branch of state.branches) {
      if (!ancestor(branch.commit)) throw new Error(`Batch no longer contains ${branch.name}; restore its merge before continuing`)
    }
    regenerate()
    checkMessages()
    const checkedHead = git(state.worktree, 'rev-parse', 'HEAD')
    // Merge first, test in full afterwards (docs/development.md, "Testing"): a batch gates on
    // typecheck, lint and the unit tests; the CI keeper runs the full suites on main.
    if (!state.dryRun) {
      run('pnpm', ['typecheck'])
      run('pnpm', ['lint'])
      run('pnpm', ['remote', 'test'])
    }
    clean()
    if (git(state.worktree, 'rev-parse', 'HEAD') !== checkedHead) throw new Error('HEAD changed during checks; continue to check again')
    if (push) publish(checkedHead)
    else console.log(`${state.dryRun ? 'Dry run finished (no checks run)' : 'Checks passed; nothing pushed'}. Worktree retained: ${state.worktree}\nLog: ${logPath}`)
  } finally {
    closeSync(fd)
    unlinkSync(lock)
  }
}

try { main() } catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
