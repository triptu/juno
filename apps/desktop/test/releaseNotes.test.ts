import { describe, expect, it } from 'bun:test'
import { addChangelogEntry, compareVersions, normalizeVersion, notesBetween, parseChangelog } from '../src/main/releaseNotes'

describe('compareVersions', () => {
  it('orders by major, minor and patch as numbers', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('v0.3.1', '0.3.1')).toBe(0)
  })

  it('ranks a pre-release below its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
  })

  it('ignores build metadata and rejects anything else', () => {
    expect(compareVersions('1.0.0+abc', '1.0.0')).toBe(0)
    expect(() => compareVersions('1.0', '1.0.0')).toThrow()
    expect(() => normalizeVersion('01.0.0')).toThrow()
  })
})

const changelog = `# Changelog

Newest first.

## 0.3.0 - 2026-11-02

- Peek shows the last reply.
- Long lines in the sidebar
  wrap to two lines.

### Fixed
* A crash on sign out.

## [0.2.0] - 2026-10-20

- Updates from the releases repository.

## Unreleased

- Not a version.

## v0.1.0

- First build.
`

describe('parseChangelog', () => {
  it('reads each version section as plain lines', () => {
    expect(parseChangelog(changelog)).toEqual([
      { version: '0.3.0', date: '2026-11-02', lines: ['Peek shows the last reply.', 'Long lines in the sidebar wrap to two lines.', 'Fixed', 'A crash on sign out.'] },
      { version: '0.2.0', date: '2026-10-20', lines: ['Updates from the releases repository.'] },
      { version: '0.1.0', date: null, lines: ['First build.'] },
    ])
  })

  it('picks the versions between the installed one and an update', () => {
    const entries = parseChangelog(changelog)
    expect(notesBetween(entries, '0.1.0', '0.3.0').map((entry) => entry.version)).toEqual(['0.3.0', '0.2.0'])
    expect(notesBetween(entries, null, '0.2.0').map((entry) => entry.version)).toEqual(['0.2.0', '0.1.0'])
    expect(notesBetween(entries, '0.3.0', '0.3.0')).toEqual([])
  })
})

describe('addChangelogEntry', () => {
  it('puts the new section above the newest one', () => {
    const next = addChangelogEntry(changelog, { version: 'v0.4.0', date: '2026-12-01', lines: ['Faster search.'] })
    expect(parseChangelog(next)[0]).toEqual({ version: '0.4.0', date: '2026-12-01', lines: ['Faster search.'] })
    expect(next.startsWith('# Changelog\n\nNewest first.\n\n## 0.4.0 - 2026-12-01\n\n- Faster search.\n\n## 0.3.0')).toBe(true)
  })

  it('appends to a changelog with no sections, and refuses a repeat or an empty entry', () => {
    expect(parseChangelog(addChangelogEntry('# Changelog\n', { version: '0.1.0', date: null, lines: ['First.'] }))).toHaveLength(1)
    expect(() => addChangelogEntry(changelog, { version: '0.2.0', date: null, lines: ['Again.'] })).toThrow()
    expect(() => addChangelogEntry(changelog, { version: '0.5.0', date: null, lines: [] })).toThrow()
  })
})
