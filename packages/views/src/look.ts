/**
 * From the row view model's names to what the primitives draw.
 *
 * `TopicRow.channel.icon` and `.color` (and `Person.color`) are the domain's
 * names: the icon list is Lucide-named (`flask-conical`, `zap`) and the hues
 * are kebab-case (`emerald-dark`). The primitives take Phosphor keys and
 * camel-case hues, so the two tables below translate. An icon with no
 * Phosphor counterpart draws the channel's first letter instead.
 */
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { ConversationKind } from '@juno/contract'
import { channelIconNames, firstGrapheme, hueForId, hueNames, type ChannelIconName, type HueName, type PhosphorIcon } from '@juno/ui'

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

const LETTER = /^[\p{L}\p{N}]/u

/**
 * "Maya Chen" to "MC"; "tushar" to "T". At most two letters, taken whole
 * (never half of an emoji). Words that start with a letter or digit win, so
 * "🦄 Unicorn" gives "U"; a name with no such word gives its first emoji.
 */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter((part) => part.length > 0)
  const words = parts.filter((part) => LETTER.test(part))
  if (words.length === 0) return firstGrapheme(parts[0] ?? '')
  const letters = words.length >= 2 ? `${firstGrapheme(words[0]!)}${firstGrapheme(words[words.length - 1]!)}` : firstGrapheme(words[0]!)
  return letters.toUpperCase()
}

/** "Maya, Leo" to "ML": the first letter of each name in a group DM, at most two. */
export function groupInitials(name: string): string {
  return name
    .split(',')
    .map((part) => firstGrapheme(initials(part)))
    .filter((letter) => letter.length > 0)
    .slice(0, 2)
    .join('')
}

/**
 * The unread count as the tag shows it: counts over 99 read "99+", and a
 * count the engine only knows as a lower bound reads "60+".
 */
export function countLabel(count: number, exact = true): string {
  if (count > 99) return '99+'
  return exact ? String(count) : `${count}+`
}

/**
 * The icon for a kind of conversation, wherever a place is named without its
 * tile: # for a public channel, a lock for a private one, a person for a DM
 * and two for a group DM. The header's pill, a row's meta line, the scope
 * chip and the view sheet all use it.
 */
export function kindIcon(kind: ConversationKind): PhosphorIcon {
  switch (kind) {
    case 'private':
      return Lock
    case 'im':
      return User
    case 'mpim':
      return Users
    default:
      return Hash
  }
}

/** A title matches when each word of the query starts a word in it, in any order (the topic switcher, Home's topic list). */
export function titleMatches(title: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '')
  if (words.length === 0) return true
  const titleWords = title.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return words.every((word) => titleWords.some((each) => each.startsWith(word)))
}
