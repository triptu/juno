// Which nightly-tier files a release must run (docs/development.md, "Nightly
// tests"). Nightly runs are not scheduled, so a release must not ship code no
// nightly test has seen. For each file that holds a nightly test
// (scripts/nightly-tests.mjs), the newest passing run of its nightly tests at
// an ancestor is its evidence; the file runs again when the change since that
// commit reaches it, as `bun run affected --wide` decides (the coverage map,
// else the import graph), leaving out the repository's scripts. A file with no
// evidence runs.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDesktopSpec, nightlyFiles, repoPath } from './nightly-tests.mjs'
import { suitePassed } from './verify-repair.mjs'

const SKIPS_NIGHTLY = /^JUNO_SKIP_TAGS=.*@nightly/
/** The test files a suite's command named, as repo paths; none means the whole suite. */
const namedFiles = (words, script) => words.slice(words.indexOf(script) + 1).filter((word) => !word.startsWith('-') && word.endsWith('.ts')).map(repoPath)

/**
 * The commit at which `record` shows `file`'s nightly tests passing, or undefined. A `test:nightly` suite shows
 * the files it ran; the lane that runs the file shows it when it did not skip @nightly (a nightly run, and every
 * run before the tier). A reused suite passed at the commit it was reused from.
 */
export function evidenceCommit(record, file, isAncestor) {
  if (record.smoke === true) return undefined
  const covers = (suite, script) => {
    if (!suite || !suitePassed(suite)) return false
    const words = suite.command ?? [script]
    if (script !== 'test:nightly' && words.some((word) => SKIPS_NIGHTLY.test(word))) return false
    const named = namedFiles(words, script)
    return named.length === 0 || named.includes(file)
  }
  const at = (suite) => suite.reusedFrom?.commit ?? record.commit
  const find = (script) => record.suites.find((suite) => suite.suite === script)
  const nightly = find('test:nightly')
  if (covers(nightly, 'test:nightly')) return at(nightly)
  const lanes = !isDesktopSpec(file) ? ['test:dom'] : find('test:browser') || find('test:electron') ? ['test:browser', 'test:electron'] : ['test:desktop']
  const suites = lanes.map(find)
  if (!suites.every((suite, index) => covers(suite, lanes[index]))) return undefined
  // Lanes reused from different runs: the oldest commit is the one every lane has seen.
  return suites.map(at).reduce((oldest, commit) => (isAncestor(commit, oldest) ? commit : oldest))
}

/**
 * Each nightly file at `commit` in `checkout`: its evidence (the nearest commit among `records`), and whether it
 * must run. `reached(base)` gives the files the change from `base` to `commit` reaches.
 */
export function nightlyReach({ files, commit, records, isAncestor, distance, reached }) {
  const reaches = new Map()
  return files.map((file) => {
    const candidates = records.flatMap((record) => {
      const at = evidenceCommit(record, file, isAncestor)
      return at !== undefined && isAncestor(at, commit) ? [{ commit: at, finishedAt: record.finishedAt }] : []
    })
    const evidence = candidates.toSorted((a, b) => distance(a.commit, commit) - distance(b.commit, commit) || b.finishedAt.localeCompare(a.finishedAt))[0]
    if (evidence === undefined) return { file, run: true, why: 'no passing nightly run at an ancestor' }
    if (evidence.commit === commit) return { file, evidence, run: false, why: 'passed at this commit' }
    if (!reaches.has(evidence.commit)) reaches.set(evidence.commit, reached(evidence.commit))
    return reaches.get(evidence.commit).has(file)
      ? { file, evidence, run: true, why: `the change since ${evidence.commit.slice(0, 10)} reaches it` }
      : { file, evidence, run: false, why: `unchanged inputs since it passed at ${evidence.commit.slice(0, 10)}` }
  })
}

/** nightlyReach in a checkout of `commit`, with the run records of this machine. */
export function checkoutReach(checkout, commit, records, env = process.env) {
  const git = (...args) => spawnSync('git', args, { cwd: checkout, encoding: 'utf8' })
  const tracked = git('ls-files', '--', 'apps/desktop/e2e', 'apps/desktop/dom').stdout.split('\n').filter(Boolean)
  const files = nightlyFiles(tracked, (file) => readFileSync(join(checkout, file), 'utf8'))
  const counts = new Map()
  return nightlyReach({
    files, commit, records,
    isAncestor: (ancestor, descendant) => ancestor === descendant || git('merge-base', '--is-ancestor', ancestor, descendant).status === 0,
    distance: (from, to) => {
      if (!counts.has(from)) counts.set(from, Number(git('rev-list', '--count', `${from}..${to}`).stdout.trim()))
      return counts.get(from)
    },
    reached: (base) => {
      const plan = spawnSync(process.execPath, [join(checkout, 'scripts/affected.mjs'), '--plan', '--json', '--wide', '--no-cache', '--app-changes', '--range', `${base}..${commit}`], { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })
      if (plan.status !== 0) throw new Error(`Could not plan the nightly reach from ${base}: ${plan.stderr}`)
      return new Set(JSON.parse(plan.stdout).steps.filter((step) => step.script === 'test:desktop' || step.script === 'test:dom').flatMap((step) => step.items))
    },
  })
}
