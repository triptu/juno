import type { EmojiCategory } from '@juno/richtext'

export interface PickerCustomEmoji {
  readonly name: string
  readonly url?: string
  readonly unicode?: string
  readonly aliases?: ReadonlyArray<string>
  readonly keys?: ReadonlyArray<string>
}
export interface PickerItem extends PickerCustomEmoji {
  readonly insert?: string
  readonly keys: ReadonlyArray<string>
}
type Item = PickerItem
export type PreparedEmojiPicker = ReturnType<typeof prepare>

function standardItem(emoji: EmojiCategory['emoji'][number]): Item {
  return { name: emoji.name, insert: emoji.unicode, unicode: emoji.unicode, aliases: emoji.aliases, keys: [emoji.name, ...emoji.aliases ?? []].map((name) => name.toLowerCase()) }
}

/** Cached by immutable data identity, so closing and reopening does not rebuild the catalog or search keys. */
const catalogs = new WeakMap<ReadonlyArray<EmojiCategory>, WeakMap<ReadonlyArray<PickerCustomEmoji>, ReturnType<typeof prepare>>>()
export function prepareEmojiPicker(catalog: ReadonlyArray<EmojiCategory>, custom: ReadonlyArray<PickerCustomEmoji>) {
  let workspaces = catalogs.get(catalog)
  if (workspaces === undefined) { workspaces = new WeakMap(); catalogs.set(catalog, workspaces) }
  let value = workspaces.get(custom)
  if (value === undefined) { value = prepare(catalog, custom); workspaces.set(custom, value) }
  return value
}
function prepare(catalog: ReadonlyArray<EmojiCategory>, custom: ReadonlyArray<PickerCustomEmoji>) {
  const standard = catalog.map((category) => ({ heading: category.name, items: category.emoji.map(standardItem) }))
  const names = new Map<string, Item>()
  for (const category of standard) for (const item of category.items) for (const name of item.keys) names.set(name, item)
  const customItems: Item[] = []
  const workspaceAliases = new Map<string, Item>()
  for (const emoji of custom) {
    if (emoji.url === undefined) {
      const item = names.get(emoji.name)
      if (item !== undefined) {
        const aliases = [...item.aliases ?? [], ...emoji.aliases ?? []]
        Object.assign(item, { aliases, keys: [item.name, ...aliases].map((name) => name.toLowerCase()) })
        for (const alias of aliases) names.set(alias, item)
      }
      continue
    }
    const item: Item = hasSearchData(emoji) ? emoji : { name: emoji.name, url: emoji.url, aliases: emoji.aliases, keys: [emoji.name, ...emoji.aliases ?? []].map((name) => name.toLowerCase()) }
    customItems.push(item)
    for (const alias of item.aliases ?? []) workspaceAliases.set(alias.toLowerCase(), item)
  }
  // Canonical workspace names are sorted. Keep only aliases in the map instead
  // of allocating another entry for every image in a large workspace.
  if (customItems.some((item, index) => index > 0 && customItems[index - 1]!.keys[0]! > item.keys[0]!)) customItems.sort((a, b) => a.keys[0]! < b.keys[0]! ? -1 : a.keys[0]! > b.keys[0]! ? 1 : 0)
  const byName = { get(name: string, kind?: 'standard' | 'workspace'): Item | undefined {
    if (kind === 'standard') return names.get(name)
    let low = 0
    let high = customItems.length - 1
    while (low <= high) {
      const middle = (low + high) >>> 1
      const item = customItems[middle]!
      const key = item.keys[0]!
      if (key === name) return item
      if (key < name) low = middle + 1
      else high = middle - 1
    }
    return workspaceAliases.get(name) ?? (kind === 'workspace' ? undefined : names.get(name))
  } }
  return { standard, customItems, byName, all: [...standard.flatMap((category) => category.items), ...customItems] }
}

function hasSearchData(emoji: PickerCustomEmoji): emoji is PickerItem {
  return emoji.keys !== undefined
}
