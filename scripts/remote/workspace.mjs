import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Paths that must never leave the Mac, even if someone forgot to ignore them. */
const secretPath = /(^|\/)(\.env(\.(?!example$)[^/]*)?|.*\.(pem|key|p12|keychain-db)|id_(rsa|ed25519)[^/]*|token\.json)$/
/** A real Slack token (digits after the prefix) or session cookie in file contents. Test stand-ins like xoxc-fresh-0000 do not match. */
const secretText = /xox[abcdeprs]-\d{6,}-\d{6,}|xoxd-[A-Za-z0-9%]{40,}/

/** The worktree as git sees it, checked for secrets. */
export function snapshot(root) {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  // Design images and prototypes under docs/ are not test inputs and are most of the bytes.
  const files = listed.stdout
    .split('\0')
    .filter((file) => file && !(file.startsWith('docs/') && !file.endsWith('.md')) && existsSync(join(root, file)) && statSync(join(root, file)).isFile())
  const problems = []
  let bytes = 0
  for (const file of files) {
    if (secretPath.test(file)) problems.push(`${file}: looks like a secret file`)
    const size = statSync(join(root, file)).size
    bytes += size
    if (size < 4 * 1024 * 1024 && secretText.test(readFileSync(join(root, file), 'latin1'))) problems.push(`${file}: contains what looks like a Slack token`)
  }
  if (problems.length > 0) throw new Error(`Not sending this worktree:\n  ${problems.join('\n  ')}`)
  return { files, bytes }
}
