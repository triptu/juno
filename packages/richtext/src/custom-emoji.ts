import type { EmojiCategory } from './emoji'

/** One row of the `emoji` table: an image url, or the name it is an alias for. */
export interface CustomEmojiRow {
  readonly name: string
  readonly url?: string | null
  readonly alias_for?: string | null
}

export type ResolvedWorkspaceEmoji = {
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly keys: ReadonlyArray<string>
} & ({ readonly url: string; readonly unicode?: never } | { readonly unicode: string; readonly url?: never })

/** Resolve each alias once. Missing targets and cycles have no display. Standard targets keep their glyph. */
interface StandardEmoji { readonly name: string; readonly unicode: string; readonly aliases?: ReadonlyArray<string> }
const EMPTY: ReadonlyArray<StandardEmoji> = []
const EMPTY_CATALOG: ReadonlyArray<EmojiCategory> = []
const catalogs = new WeakMap<ReadonlyArray<EmojiCategory>, ReadonlyArray<StandardEmoji>>()
function standardEntries(catalog: ReadonlyArray<EmojiCategory>) {
  let entries = catalogs.get(catalog)
  if (entries === undefined) { entries = catalog.flatMap((category) => category.emoji); catalogs.set(catalog, entries) }
  return entries
}
const NO_ALIASES: string[] = []
type ImageRow = CustomEmojiRow & { readonly url: string }
type Resolved = ImageRow | { name: string; unicode: string }
type EmojiLookup = (name: string) => Resolved | undefined
const resolvedTables = new WeakMap<ReadonlyArray<StandardEmoji>, WeakMap<ReadonlyArray<CustomEmojiRow>, EmojiLookup>>()
const standardTables = new WeakMap<ReadonlyArray<StandardEmoji>, Map<string, { name: string; unicode: string }>>()
function standardLookup(standard: ReadonlyArray<StandardEmoji>) {
  let table = standardTables.get(standard)
  if (table === undefined) {
    table = new Map()
    for (const emoji of standard) for (const name of [emoji.name, ...emoji.aliases ?? []]) table.set(name, { name: emoji.name, unicode: emoji.unicode })
    standardTables.set(standard, table)
  }
  return table
}
function resolveRows(rows: ReadonlyArray<CustomEmojiRow>, standard: ReadonlyArray<StandardEmoji>) {
  let tables = resolvedTables.get(standard)
  if (tables === undefined) { tables = new WeakMap(); resolvedTables.set(standard, tables) }
  const cached = tables.get(rows)
  if (cached !== undefined) return cached
  const sorted = rows.every((row, index) => index === 0 || rows[index - 1]!.name <= row.name)
  const byName = sorted ? undefined : new Map(rows.map((row) => [row.name, row]))
  const find = (name: string) => {
    if (byName !== undefined) return byName.get(name)
    let low = 0
    let high = rows.length - 1
    while (low <= high) {
      const middle = (low + high) >>> 1
      const row = rows[middle]!
      if (row.name === name) return row
      if (row.name < name) low = middle + 1
      else high = middle - 1
    }
    return undefined
  }
  const aliases = new Map<string, Resolved | undefined>()
  const resolve = (name: string): Resolved | undefined => {
    const direct = find(name)
    if (direct !== undefined && hasImage(direct)) return direct
    if (aliases.has(name)) return aliases.get(name)
    const trail: string[] = []
    const seen = new Set<string>()
    let current = name
    let target: Resolved | undefined
    while (!seen.has(current)) {
      if (aliases.has(current)) { target = aliases.get(current); break }
      seen.add(current)
      trail.push(current)
      const row = find(current)
      if (row !== undefined && hasImage(row)) { target = row; break }
      if (row?.alias_for) { current = row.alias_for; continue }
      target = standardLookup(standard).get(current)
      break
    }
    for (const visited of trail) aliases.set(visited, target)
    return target
  }
  tables.set(rows, resolve)
  return resolve
}

/** A workspace lookup, including aliases. Missing targets and cycles keep their shortcode. */
export function customEmojiLookup(rows: ReadonlyArray<CustomEmojiRow>): (name: string) => string | undefined {
  const resolved = resolveRows(rows, EMPTY)
  return (name) => { const emoji = resolved(name); return emoji !== undefined && 'url' in emoji ? emoji.url : undefined }
}

const workspaceTables = new WeakMap<ReadonlyArray<StandardEmoji>, WeakMap<ReadonlyArray<CustomEmojiRow>, ReadonlyArray<ResolvedWorkspaceEmoji>>>()

/** One canonical entry per image or standard target, with all workspace aliases. */
export function workspaceEmoji(rows: ReadonlyArray<CustomEmojiRow>, catalog: ReadonlyArray<EmojiCategory> = EMPTY_CATALOG): ReadonlyArray<ResolvedWorkspaceEmoji> {
  const standard = standardEntries(catalog)
  let tables = workspaceTables.get(standard)
  if (tables === undefined) { tables = new WeakMap(); workspaceTables.set(standard, tables) }
  const cached = tables.get(rows)
  if (cached !== undefined) return cached
  const resolve = resolveRows(rows, standard)
  const grouped = new Map<string, { target: Resolved; aliases: string[] }>()
  for (const row of rows) {
    if (hasImage(row)) continue
    const target = resolve(row.name)
    if (target === undefined || row.name === target.name) continue
    let group = grouped.get(target.name)
    if (group === undefined) { group = { target, aliases: [] }; grouped.set(target.name, group) }
    group.aliases.push(row.name)
  }
  const result: ResolvedWorkspaceEmoji[] = []
  let ordered = true
  let previous = ''
  const add = (target: Resolved, aliases: ReadonlyArray<string>) => {
    if (target.name < previous) ordered = false
    previous = target.name
    const keys = aliases.length === 0 ? [target.name.toLowerCase()] : [target.name.toLowerCase(), ...aliases.map((name) => name.toLowerCase())]
    result.push('url' in target
      ? { name: target.name, url: target.url, aliases, keys }
      : { name: target.name, unicode: target.unicode, aliases, keys })
  }
  for (const row of rows) {
    if (!hasImage(row)) continue
    add(row, grouped.get(row.name)?.aliases ?? NO_ALIASES)
    grouped.delete(row.name)
  }
  for (const { target, aliases } of grouped.values()) add(target, aliases)
  if (!ordered) result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  tables.set(rows, result)
  return result
}

function hasImage(row: CustomEmojiRow): row is ImageRow {
  return !row.alias_for && typeof row.url === 'string' && row.url.length > 0
}
