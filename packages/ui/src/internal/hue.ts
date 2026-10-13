/**
 * The eight person hues and the rule that picks one from an id. Shared by
 * Avatar, ChannelIcon and the person Chip so a person or channel gets the
 * same colour everywhere.
 */
export type HueName = 'cyan' | 'claret' | 'midnight' | 'emeraldDark' | 'plum' | 'rose' | 'emerald' | 'jordy'

export const hueNames: ReadonlyArray<HueName> = [
  'cyan',
  'claret',
  'midnight',
  'emeraldDark',
  'plum',
  'rose',
  'emerald',
  'jordy',
]

/**
 * A stable hue for an id (a Slack user or channel id). FNV-1a over the
 * string, so the same id gets the same hue in every list and on every
 * machine, and neighbouring ids spread across the set.
 */
export function hueForId(id: string): HueName {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hueNames[hash % hueNames.length] ?? 'rose'
}
