import { assessRecord, compatible, git, isAncestor } from './release-gate.mjs'

export function selectCommit(root, tip, records) {
  const eligible = records.filter((record) => assessRecord(record) && isAncestor(root, record.commit, tip))
  if (!eligible.length) return null
  for (const commit of git(root, 'rev-list', '--first-parent', tip).split('\n')) {
    const record = eligible.find((entry) => compatible(root, entry.commit, commit))
    if (record) return commit
  }
  return null
}

export function releaseDue({ candidate, previous, publishedAt, now = Date.now() }) {
  if (!candidate) return 'no commit has an eligible full-run record'
  if (candidate === previous) return 'the selected commit is already released'
  if (publishedAt && now - Date.parse(publishedAt) < 6 * 60 * 60 * 1000) return 'the last release was less than 6 hours ago'
  return null
}

/** Commit subjects are already plain English. Drop maintenance and group the remaining changes by area. */
export function releaseNotes(subjects) {
  const areas = new Map()
  for (const raw of subjects) {
    const subject = raw.replace(/^(fix|feat|perf)(\([^)]*\))?:\s*/i, '')
    if (/^(Merge |Release \d|Set version to \d|Revert |test[(: ]|docs?[(: ]|chore[(: ]|ci[(: ]|build[(: ])/i.test(raw)
      || /\b(test|tests|spec|specs|coverage|fixture|fixtures|quint|lint|typecheck|worktree|keeper)\b/i.test(subject)) continue
    const area = /\b(chat|composer|message|messages|reaction|reactions|send|draft)\b/i.test(subject) ? 'Messages'
      : /\b(sidebar|topic|topics|home|tab|tabs|search|palette)\b/i.test(subject) ? 'Navigation'
      : /\b(setting|settings|update|updates|release|releases|dmg)\b/i.test(subject) ? 'Settings and updates' : 'Reliability'
    const line = `${subject[0]?.toUpperCase() ?? ''}${subject.slice(1).replace(/[.!]$/, '')}.`
    areas.set(area, [...new Set([...(areas.get(area) ?? []), line])])
  }
  return [...areas].flatMap(([area, lines]) => lines.map((line) => `- ${area}: ${line}`)).join('\n') + '\n'
}
