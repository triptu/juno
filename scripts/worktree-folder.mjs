// Where agent worktrees and other large scratch folders go.
//
// The AgentWork volume has file event logging and Spotlight off, so creating
// and deleting many files there does not load fseventsd. It counts as mounted
// when its `.fseventsd/no_log` marker exists. Without it, worktrees go in
// <repo>/.claude/worktrees and scratch folders in the system temp folder.
// `JUNO_WORKTREE_DIR` overrides the worktree folder (the batch tests use it).
//
// See docs/development.md, "Worktrees and installs".

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const AGENT_WORK = '/Volumes/AgentWork'

/** The AgentWork volume's path when it is mounted, else undefined. */
export function agentWork({ exists = existsSync } = {}) {
  return exists(join(AGENT_WORK, '.fseventsd/no_log')) ? AGENT_WORK : undefined
}

/**
 * The main checkout of the repository that `checkout` belongs to. A linked
 * worktree's own folder name (such as t3-1234) is not the repository's name.
 */
export function mainCheckout(checkout) {
  const common = execFileSync('git', ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
  return dirname(common)
}

/** The folder that holds the worktrees of the repository whose main checkout is `main`. */
export function worktreeFolder(main, { env = process.env, exists = existsSync } = {}) {
  if (env.JUNO_WORKTREE_DIR) return env.JUNO_WORKTREE_DIR
  const volume = agentWork({ exists })
  return volume ? join(volume, 'worktrees', basename(main)) : join(main, '.claude/worktrees')
}

/** A parent folder for large temporary copies, such as the packaging deploy. */
export function scratchFolder({ exists = existsSync } = {}) {
  const volume = agentWork({ exists })
  return volume ? join(volume, 'tmp') : tmpdir()
}
