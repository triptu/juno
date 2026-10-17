/**
 * Versions and the changelog of the releases repository (docs/development.md,
 * "Releasing"). Pure, with no imports, so `scripts/release-publish.ts` runs it
 * under plain Node as well as main.
 */

interface Parsed {
  readonly core: readonly [number, number, number]
  readonly pre: readonly string[]
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/

function parse(version: string): Parsed | null {
  const match = SEMVER.exec(version.trim())
  if (match === null) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] === undefined ? [] : match[4].split('.') }
}

/** A semver version such as `0.2.0` or `1.0.0-beta.1`, with or without a leading `v`. */
export function isVersion(version: string): boolean {
  return parse(version) !== null
}

/** The version without a leading `v` or build metadata. Throws on anything that is not semver. */
export function normalizeVersion(version: string): string {
  const parsed = parse(version)
  if (parsed === null) throw new Error(`Not a semver version: ${version}`)
  return parsed.core.join('.') + (parsed.pre.length === 0 ? '' : `-${parsed.pre.join('.')}`)
}

function comparePre(a: readonly string[], b: readonly string[]): number {
  // A version without a pre-release ranks above the same version with one.
  if (a.length === 0 || b.length === 0) return b.length - a.length
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!
    const y = b[i]!
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn && Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    if (xn !== yn) return xn ? -1 : 1
    if (!xn && x !== y) return x < y ? -1 : 1
  }
  return Math.sign(a.length - b.length)
}

/** Semver precedence: negative when `a` is older than `b`, 0 when equal, positive when newer. Throws on non-semver input. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  if (x === null || y === null) throw new Error(`Not a semver version: ${x === null ? a : b}`)
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! < y.core[i]! ? -1 : 1
  return comparePre(x.pre, y.pre)
}

export interface ChangelogEntry {
  readonly version: string
  /** `YYYY-MM-DD`, or null when the heading has none. */
  readonly date: string | null
  /** One line per change, as plain text. */
  readonly lines: readonly string[]
}

const HEADING = /^##\s+\[?v?([0-9][^\s\]]*)\]?(?:\s+[-–]\s+(\d{4}-\d{2}-\d{2}))?\s*$/

/**
 * The sections of CHANGELOG.md, in file order. A section is `## <version> - <date>`
 * followed by lines; list markers and sub-heading hashes are dropped, and an indented
 * line continues the line above. Text before the first section, and sections whose
 * heading is not a semver version, are skipped.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: { version: string; date: string | null; lines: string[] } | null = null
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (raw.startsWith('## ')) {
      const match = HEADING.exec(raw)
      current = match !== null && isVersion(match[1]!) ? { version: normalizeVersion(match[1]!), date: match[2] ?? null, lines: [] } : null
      if (current !== null) entries.push(current)
      continue
    }
    if (current === null || raw.trim() === '') continue
    const continues = /^\s/.test(raw) && !/^\s*[-*+]\s/.test(raw) && current.lines.length > 0
    const text = raw.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '')
    if (continues) current.lines[current.lines.length - 1] += ` ${text}`
    else current.lines.push(text)
  }
  return entries
}

/** Entries newer than `after` and no newer than `upTo`, newest first. `after` null means from the start. */
export function notesBetween(entries: readonly ChangelogEntry[], after: string | null, upTo: string): ChangelogEntry[] {
  return entries
    .filter((entry) => compareVersions(entry.version, upTo) <= 0 && (after === null || compareVersions(entry.version, after) > 0))
    .sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * CHANGELOG.md with a new section for `version` above the existing ones. Throws when
 * the version already has a section, or when `lines` is empty.
 */
export function addChangelogEntry(markdown: string, entry: ChangelogEntry): string {
  const version = normalizeVersion(entry.version)
  if (parseChangelog(markdown).some((existing) => existing.version === version)) throw new Error(`CHANGELOG.md already has ${version}`)
  if (entry.lines.length === 0) throw new Error('A changelog entry needs at least one line')
  const section = `## ${version}${entry.date === null ? '' : ` - ${entry.date}`}\n\n${entry.lines.map((line) => `- ${line}`).join('\n')}\n`
  const text = markdown.replace(/\r\n?/g, '\n')
  const first = text.search(/^## /m)
  if (first === -1) return `${text.trimEnd()}\n\n${section}`
  return `${text.slice(0, first)}${section}\n${text.slice(first)}`
}
