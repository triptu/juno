import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareVersions, isVersion, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'
import { git } from './release-gate.mjs'
import { scratchFolder } from './worktree-folder.mjs'

const file = 'apps/desktop/package.json'

/**
 * Commits one change on today's origin/main in a scratch checkout and pushes it,
 * never the caller's checkout. `write(checkout)` makes the change and returns the
 * paths to stage; `settled()` says origin/main already has it. On a conflicting
 * concurrent push it recreates the change on the new tip. Returns false when
 * nothing was needed.
 */
export function commitOnMain(root, message, write, settled) {
  let scratch
  let checkout
  try {
    git(root, 'fetch', 'origin', 'main')
    if (settled()) return false
    mkdirSync(scratchFolder(), { recursive: true })
    scratch = mkdtempSync(join(scratchFolder(), 'juno-release-main-'))
    const path = join(scratch, 'checkout')
    git(root, 'worktree', 'add', '--detach', path, 'origin/main')
    checkout = path
    const commit = () => {
      git(checkout, 'add', '--', ...write(checkout))
      git(checkout, 'commit', '-m', message)
    }
    commit()
    for (let attempt = 0; attempt < 4; attempt++) {
      const push = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: checkout, encoding: 'utf8' })
      if (push.status === 0) return true
      git(checkout, 'fetch', 'origin', 'main')
      if (settled()) return true
      const rebase = spawnSync('git', ['rebase', 'origin/main'], { cwd: checkout, encoding: 'utf8' })
      if (rebase.status !== 0) {
        git(checkout, 'rebase', '--abort')
        git(checkout, 'reset', '--hard', 'origin/main')
        commit()
      }
    }
    throw new Error('main push failed after 4 attempts')
  } finally {
    if (checkout) git(root, 'worktree', 'remove', '--force', checkout)
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}

/** Replay only the released version on today's main, never the release checkout. */
export function syncReleasedVersion(root, released) {
  if (!isVersion(released)) throw new Error('invalid released version')
  const version = normalizeVersion(released)
  const current = () => JSON.parse(git(root, 'show', `origin/main:${file}`)).version
  try {
    // Only the version field changes, so every other field of a newer main survives.
    return commitOnMain(root, `Set version to ${version} after release`, (checkout) => {
      const path = join(checkout, file)
      writeFileSync(path, readFileSync(path, 'utf8').replace(/("version"\s*:\s*")[^"]+"/, `$1${version}"`))
      return [file]
    }, () => compareVersions(current(), version) >= 0)
  } catch {
    throw new Error(`Release ${version} is published, but updating origin/main failed. Rerun bun run release (or release:publish) to finish the version update without publishing again.`)
  }
}

/** Check the published artifacts before advancing main, including when resuming. */
export function checkPublishedRelease(repo, version) {
  const tag = `v${normalizeVersion(version)}`
  const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }))
  const release = gh('api', `repos/${repo}/releases/latest`)
  const names = release.assets.map((asset) => asset.name).toSorted()
  const dmg = names.find((name) => name.endsWith('.dmg'))
  const problems = [
    ...(release.draft || release.prerelease ? ['it is a draft or a pre-release'] : []),
    ...(!dmg ? ['it has no DMG'] : !names.includes(`${dmg}.blockmap`) ? ['it has no matching DMG block map'] : []),
    ...(names.includes('latest-mac.yml') ? [] : ['it has no latest-mac.yml']),
    ...(release.tag_name === tag ? [] : [`the latest release is ${release.tag_name ?? 'none'}`]),
  ]
  if (problems.length) throw new Error(`${tag} is published, but ${problems.join('; ')}`)
  console.log(`release: checked ${tag}: ${names.join(', ')}; marked latest`)
}
