// Reads what the status page shows. Every reader returns an empty value when
// its file or git is missing, so the page always builds.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tag } from './status-areas.mjs'

const read = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

// `- 10-17 12:00 · who · text` lines, newest first, as in the file.
export const readDecisions = (root) =>
  read(join(root, 'docs/decision-log.md'))
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const [when = '', who = '', ...rest] = line.slice(2).split(' · ')
      const text = rest.join(' · ')
      const [day = '', time = ''] = when.split(' ')
      return { day, time, who, text, areas: tag(who, text) }
    })

const git = (root, args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TZ: 'Asia/Kolkata' },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

const rows = (raw) =>
  raw
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\x1f'))

// What landed on main: one item per first-parent commit. A merge lists the
// branch's own commits, found by following first parents from its second
// parent until main's line is reached.
export const readLanded = (root, limit = 30) => {
  const format = '--format=%H%x1f%P%x1f%ad%x1f%s'
  const date = '--date=format-local:%m-%d %H:%M'
  const graph = new Map(
    rows(git(root, ['log', 'main', '-n', '800', format, date])).map(([hash, parents, when, subject]) => [
      hash,
      { parents: parents.split(' '), when, subject },
    ]),
  )
  const line = rows(git(root, ['log', 'main', '--first-parent', '-n', String(limit + 20), format, date]))
  const onMain = new Set(line.map(([hash]) => hash))
  return line
    .filter(([, , , subject]) => !subject.startsWith('Regenerate batch decision log'))
    .slice(0, limit)
    .map(([hash, parents, when, subject]) => {
      const merged = []
      let next = parents.split(' ')[1]
      while (next && !onMain.has(next) && graph.has(next) && merged.length < 40) {
        const commit = graph.get(next)
        if (commit.parents.length < 2) merged.push(commit.subject)
        next = commit.parents[0]
      }
      const branch = /^Merge (?:branch )?'?([\w./-]+)'?/.exec(subject)?.[1] ?? ''
      return { hash: hash.slice(0, 8), when, subject, branch, merged, areas: tag(branch, subject, ...merged) }
    })
}

// The CI keeper's log: the last cycle marked GREEN and the last DMG build.
export const readKeeper = (root) => {
  const text = read(join(root, '.juno-status/ci-keeper.md'))
  let green
  for (const section of text.split('\n### ').slice(1)) {
    const heading = section.split('\n')[0]
    if (/\bGREEN\b/.test(section)) {
      green = { date: heading.split(',')[0], hash: /\b[0-9a-f]{8,40}\b/.exec(heading)?.[0] ?? '' }
    }
  }
  const dmgHash = [...text.matchAll(/DMG built from ([0-9a-f]{7,40})/g)].at(-1)?.[1]
  return { green, dmgHash }
}

// Changes on main's first-parent line after a commit, or -1 if unknown.
export const changesSince = (root, hash) => {
  const count = hash ? git(root, ['rev-list', '--count', '--first-parent', `${hash}..main`]).trim() : ''
  return count ? Number(count) : -1
}

// The DMG the owner installs: the orchestrator copies it to ~/Desktop and keeps
// the one before as `-previous.dmg`.
export const readDmg = () => {
  const dir = join(homedir(), 'Desktop')
  try {
    const name = readdirSync(dir).find((file) => /^Juno-.*\.dmg$/.test(file) && !file.endsWith('-previous.dmg'))
    return name ? { name, at: statSync(join(dir, name)).mtime } : undefined
  } catch {
    return undefined
  }
}
