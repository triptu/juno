/**
 * From the row view model's names to what the primitives draw.
 *
 * `TopicRow.channel.icon` and `.color` (and `Person.color`) are the domain's
 * names: the icon list is Lucide-named (`flask-conical`, `zap`) and the hues
 * are kebab-case (`emerald-dark`). The primitives take Phosphor keys and
 * camel-case hues, so the two tables below translate. An icon with no
 * Phosphor counterpart draws the channel's first letter instead.
 */
import { channelIconNames, hueForId, hueNames, type ChannelIconName, type HueName } from '@juno/ui'

const icons: Readonly<Record<string, ChannelIconName>> = {
  hash: 'hash',
  megaphone: 'megaphone',
  rocket: 'rocket',
  wrench: 'wrench',
  bug: 'bug',
  'flask-conical': 'flask',
  'book-open': 'book',
  coffee: 'coffee',
  globe: 'globe',
  heart: 'heart',
  zap: 'lightning',
  shield: 'shield',
  leaf: 'leaf',
}

const hues: Readonly<Record<string, HueName>> = {
  cyan: 'cyan',
  claret: 'claret',
  midnight: 'midnight',
  'emerald-dark': 'emeraldDark',
  plum: 'plum',
  rose: 'rose',
  emerald: 'emerald',
  jordy: 'jordy',
}

/** The Phosphor icon for a channel's icon name, or undefined for the first letter. Rows now carry ui keys; the table covers older fixtures. */
export function channelIconFor(name: string): ChannelIconName | undefined {
  return (channelIconNames as ReadonlyArray<string>).includes(name) ? (name as ChannelIconName) : icons[name]
}

/** The hue for a colour name; falls back to the id's hash so a row never loses its colour. */
export function hueFor(color: string, id: string): HueName {
  return (hueNames as ReadonlyArray<string>).includes(color) ? (color as HueName) : (hues[color] ?? hueForId(id))
}

/** "Maya Chen" to "MC"; "tushar" to "T". At most two letters. */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter((part) => part.length > 0)
  const letters = parts.length >= 2 ? `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}` : (parts[0] ?? '').slice(0, 1)
  return letters.toUpperCase()
}

/** "1 234" style grouping is not wanted; counts over 99 read "99+". */
export function countLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}
