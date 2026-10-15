/** The reaction picker and composers share the session's recent emoji. */
let recent: ReadonlyArray<string> = ['+1', 'white_check_mark', 'eyes']
export const recentEmoji = () => recent
export const noteRecentEmoji = (name: string) => {
  recent = [name, ...recent.filter((other) => other !== name)].slice(0, 18)
}
