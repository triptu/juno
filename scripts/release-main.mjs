import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareVersions, isVersion, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'
import { git } from './release-gate.mjs'
import { scratchFolder } from './worktree-folder.mjs'

const file = 'apps/desktop/package.json'

/** Replay only the released version on today's main, never the release checkout. */
export function syncReleasedVersion(root, released) {
  if (!isVersion(released)) throw new Error('invalid released version')
  const version = normalizeVersion(released)
  let scratch
  let checkout
  try {
    git(root, 'fetch', 'origin', 'main')
    const current = () => JSON.parse(git(root, 'show', `origin/main:${file}`)).version
    if (compareVersions(current(), version) >= 0) return false
    mkdirSync(scratchFolder(), { recursive: true })
    scratch = mkdtempSync(join(scratchFolder(), 'juno-release-main-'))
    const path = join(scratch, 'checkout')
    git(root, 'worktree', 'add', '--detach', path, 'origin/main')
    checkout = path
    const commit = () => {
      const path = join(checkout, file)
      const text = readFileSync(path, 'utf8')
      writeFileSync(path, text.replace(/("version"\s*:\s*")[^"]+"/, `$1${version}"`))
      git(checkout, 'add', '--', file)
      git(checkout, 'commit', '-m', `Set version to ${version} after release`)
    }
    commit()
    for (let attempt = 0; attempt < 4; attempt++) {
      const push = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: checkout, encoding: 'utf8' })
      if (push.status === 0) return true
      git(checkout, 'fetch', 'origin', 'main')
      if (compareVersions(current(), version) >= 0) return true
      // Rebase only our version commit. If another version change conflicts,
      // recreate that field on the new tip, preserving all its other fields.
      const rebase = spawnSync('git', ['rebase', 'origin/main'], { cwd: checkout, encoding: 'utf8' })
      if (rebase.status !== 0) {
        git(checkout, 'rebase', '--abort')
        git(checkout, 'reset', '--hard', 'origin/main')
        commit()
      }
    }
    throw new Error('main push failed after 4 attempts')
  } catch {
    throw new Error(`Release ${version} is published, but updating origin/main failed. Rerun release:scheduled or release:publish to finish the version update without publishing again.`)
  } finally {
    if (checkout) git(root, 'worktree', 'remove', '--force', checkout)
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}
