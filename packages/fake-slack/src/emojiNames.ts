/**
 * The emoji names the fake accepts in `reactions.add` and
 * `reactions.remove`, so it refuses an unknown name with `invalid_name`
 * as Slack does (live, 2026-10-16). Slack knows every standard emoji; the
 * fake knows a common subset (the quick reactions, the seeds' names and
 * the ones tests pick) and the workspace's custom emoji. A name Slack
 * spells two ways (`+1` and `thumbsup`) is known both ways.
 *
 * A skin tone is `<name>::skin-tone-<2..6>`, on names that take one.
 */
const STANDARD = [
  '+1', 'thumbsup', '-1', 'thumbsdown', 'white_check_mark', 'heavy_check_mark', 'eyes', 'tada', 'pray', 'heart', 'rocket',
  'fire', 'joy', 'smile', 'slightly_smiling_face', 'grinning', 'laughing', 'thinking_face', 'raised_hands', 'clap', 'wave',
  '100', 'ok_hand', 'muscle', 'point_up', 'sob', 'cry', 'sweat_smile', 'rolling_on_the_floor_laughing', 'heart_eyes', 'star',
  'sparkles', 'bulb', 'x', 'warning', 'question', 'exclamation', 'memo', 'ship', 'hugging_face', 'saluting_face',
] as const

/** Names that take a skin tone. */
const TONED = new Set(['+1', 'thumbsup', '-1', 'thumbsdown', 'pray', 'raised_hands', 'clap', 'wave', 'ok_hand', 'muscle', 'point_up'])

const KNOWN = new Set<string>(STANDARD)
const SKIN_TONE = /^(.+)::skin-tone-([2-6])$/

/** Whether Slack would take `name` as a reaction in a workspace with `custom` emoji. */
export function isKnownReaction(name: string, custom: ReadonlySet<string>): boolean {
  const toned = SKIN_TONE.exec(name)
  if (toned !== null) return TONED.has(toned[1]!)
  return KNOWN.has(name) || custom.has(name)
}
