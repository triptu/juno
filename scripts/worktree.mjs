// Creates and removes agent worktrees with a cheap install.
//
//   bun scripts/worktree.mjs add <name> [--base <ref>] [--branch <branch>] [--detach <ref>] [--no-install]
//   bun scripts/worktree.mjs remove <name-or-path> [--force] [--delete-branch]
//
// `add` checks out <branch> (default <name>; an existing branch is reused, a
// new one starts at --base, default origin/main; --detach checks out <ref>
// with no branch, as a DMG build does) and runs
// `bun install --frozen-lockfile`. The workspace uses Bun's global store, so
// the install links about 1,100 entries and takes under a second when the
// store is warm. It prints the worktree's path last.
//
// Worktrees go on /Volumes/AgentWork when that volume is mounted (file event
// logging and Spotlight are off there), else in <repo>/.claude/worktrees
// (`worktreeFolder` in scripts/worktree-folder.mjs).
// Either folder gets a .metadata_never_index file so Spotlight skips it.
// Local installs wait while load is above 8; an allocated remote container owns its CPU budget.
//
// See docs/development.md, "Worktrees and installs".

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { mainCheckout, worktreeFolder } from './worktree-folder.mjs'

const [command, target, ...rest] = process.argv.slice(2)
const option = (name) => {
  const at = rest.indexOf(name)
  return at === -1 ? undefined : rest[at + 1]
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

const main = mainCheckout(process.cwd())
const folder = worktreeFolder(main)

if (command === 'add' && target) await add(target)
else if (command === 'remove' && target) remove(target)
else {
  console.error('usage: bun scripts/worktree.mjs add <name> [--base <ref>] [--branch <branch>] [--detach <ref>] [--no-install]')
  console.error('       bun scripts/worktree.mjs remove <name-or-path> [--force] [--delete-branch]')
  process.exitCode = 2
}

async function add(name) {
  const path = join(folder, name)
  if (existsSync(path)) throw new Error(`${path} already exists`)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, '.metadata_never_index'), '')
  const detach = option('--detach')
  const branch = option('--branch') ?? name
  const base = option('--base') ?? 'origin/main'
  const exists = execFileSync('git', ['-C', main, 'branch', '--list', branch], { encoding: 'utf8' }).trim() !== ''
  if (detach) git('-C', main, 'worktree', 'add', '--quiet', '--detach', path, detach)
  else {
    if (!exists && base.startsWith('origin/')) git('-C', main, 'fetch', '--quiet', 'origin', base.slice('origin/'.length))
    if (exists) git('-C', main, 'worktree', 'add', '--quiet', path, branch)
    else git('-C', main, 'worktree', 'add', '--quiet', '-b', branch, path, base)
  }
  if (!rest.includes('--no-install')) {
    for (let waited = 0; process.env.JUNO_REMOTE_CONTAINER !== '1' && loadavg()[0] > 8; waited += 30) {
      if (waited % 300 === 0) console.error(`worktree: load ${loadavg()[0].toFixed(1)} is above 8; waiting to install`)
      await sleep(30_000)
    }
    execFileSync('bun', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: path, stdio: 'inherit' })
  }
  console.log(path)
}

function remove(nameOrPath) {
  const path = nameOrPath.includes('/') ? resolve(nameOrPath) : join(folder, nameOrPath)
  const branch = execFileSync('git', ['-C', path, 'branch', '--show-current'], { encoding: 'utf8' }).trim()
  git('-C', main, 'worktree', 'remove', ...(rest.includes('--force') ? ['--force'] : []), path)
  console.log(`removed ${path}`)
  if (!rest.includes('--delete-branch') || !branch) return
  // -d, not -D: a branch with commits not merged into the main checkout's branch is kept.
  try {
    execFileSync('git', ['-C', main, 'branch', '-d', branch], { stdio: 'ignore' })
    console.log(`deleted branch ${branch}`)
  } catch {
    console.log(`kept branch ${branch}: it is not merged`)
  }
}
