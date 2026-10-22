import { parseChangelog } from '../apps/desktop/src/main/releaseNotes.ts'
import { assessRecord, compatible, git, isAncestor } from './release-gate.mjs'

export function selectCommit(root, tip, records) {
  const eligible = records.filter((record) => assessRecord(record) && isAncestor(root, record.commit, tip))
  if (!eligible.length) return null
  for (const commit of git(root, 'rev-list', '--topo-order', tip).split('\n')) {
    const record = eligible.find((entry) => compatible(root, entry.commit, commit))
    if (record) return commit
  }
  return null
}

export function releaseDue({ candidate, previous }) {
  if (!candidate) return 'no commit has an eligible full-run record'
  if (candidate === previous) return 'the selected commit is already released'
  return null
}

/**
 * The commit subjects a person might notice, in order, without maintenance. They are
 * the input for the highlights the release agent writes; they are never published.
 */
export function userFacingChanges(subjects) {
  const lines = []
  for (const raw of subjects) {
    if (!raw.trim()) continue
    const subject = raw.replace(/^(fix|feat|perf)(\([^)]*\))?:\s*/i, '')
    if (/^(Merge |Release \d|Set version to \d|Revert |test[(: ]|docs?[(: ]|chore[(: ]|ci[(: ]|build[(: ])/i.test(raw)
      || /\b(test|tests|spec|specs|coverage|fixture|fixtures|quint|lint|typecheck|worktree|keeper)\b/i.test(subject)) continue
    if (!lines.includes(subject)) lines.push(subject)
  }
  return lines
}

/** The most lines a version's highlights may have. More reads as a commit list. */
export const MOST_HIGHLIGHTS = 10

/**
 * The highlight lines of a notes file, as CHANGELOG.md will show them. Throws when the
 * file is empty, longer than a short list, or carries a commit hash.
 */
export function highlightLines(text) {
  const lines = parseChangelog(`## 0.0.0\n${text}`)[0]?.lines ?? []
  if (lines.length === 0) throw new Error('the notes file has no lines')
  if (lines.length > MOST_HIGHLIGHTS) throw new Error(`the notes file has ${lines.length} lines; write at most ${MOST_HIGHLIGHTS} highlights, not one line per commit`)
  const hash = lines.find((line) => /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/.test(line))
  if (hash !== undefined) throw new Error(`a highlight carries a commit hash: ${hash}`)
  return lines
}
