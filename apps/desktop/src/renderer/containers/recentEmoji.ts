/** The reaction picker and composers share the session's recent emoji. */
let recent: ReadonlyArray<string> = []
export const recentEmoji = () => recent
export const noteRecentEmoji = (name: string) => {
  recent = [name, ...recent.filter((other) => other !== name)].slice(0, 18)
}

/** The picker's Frequently used: this session's emoji, then the quick reactions. */
export const frequentEmoji = (quick: ReadonlyArray<{ readonly name: string }>) => {
  const names = [...recent, ...quick.map((reaction) => reaction.name).filter((name) => !recent.includes(name))]
  return names.slice(0, 18)
}
