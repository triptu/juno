import { Schema } from 'effect'

const LIMIT = 18
export const RecentEmoji = Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(LIMIT))
const decode = Schema.decodeUnknownOption(RecentEmoji)

export const recentEmojiFrom = (value: unknown): ReadonlyArray<string> => {
  const decoded = decode(value)
  return decoded._tag === 'Some' ? decoded.value : []
}

/** Most recently used first, once per name, with the picker's existing cap. */
export const recordEmojiUse = (recent: ReadonlyArray<string>, name: string): ReadonlyArray<string> =>
  [name, ...recent.filter((other) => other !== name)].slice(0, LIMIT)

/** Fill unused places with the owner's quick reactions, preserving their order. */
export const frequentEmoji = (recent: ReadonlyArray<string>, quick: ReadonlyArray<{ readonly name: string }>): ReadonlyArray<string> =>
  [...new Set([...recent, ...quick.map((reaction) => reaction.name)])].slice(0, LIMIT)
