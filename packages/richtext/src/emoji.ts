/**
 * Emoji shortcodes. Slack names on the left, unicode on the right.
 *
 * This is not the full Slack table. It covers the quick reactions, the
 * 12-emoji picker and the names seen most in work chat. Anything missing
 * stays as `:name:` in text and as its name on a reaction chip, so an
 * unknown shortcode never breaks rendering. Custom workspace emoji come
 * from the `emoji` lookup, not from here.
 */

import type { CustomEmoji } from '@juno/slack-schema'

const table: Readonly<Record<string, string>> = {
  // Quick reactions and the picker
  '+1': '👍',
  thumbsup: '👍',
  '-1': '👎',
  thumbsdown: '👎',
  white_check_mark: '✅',
  eyes: '👀',
  heart: '❤️',
  joy: '😂',
  tada: '🎉',
  pray: '🙏',
  fire: '🔥',
  '100': '💯',
  open_mouth: '😮',
  cry: '😢',
  rocket: '🚀',
  // Faces
  smile: '😄',
  smiley: '😃',
  grinning: '😀',
  grin: '😁',
  laughing: '😆',
  satisfied: '😆',
  sweat_smile: '😅',
  rolling_on_the_floor_laughing: '🤣',
  slightly_smiling_face: '🙂',
  upside_down_face: '🙃',
  wink: '😉',
  blush: '😊',
  innocent: '😇',
  heart_eyes: '😍',
  kissing_heart: '😘',
  yum: '😋',
  stuck_out_tongue: '😛',
  stuck_out_tongue_winking_eye: '😜',
  zany_face: '🤪',
  thinking_face: '🤔',
  face_with_raised_eyebrow: '🤨',
  neutral_face: '😐',
  expressionless: '😑',
  no_mouth: '😶',
  smirk: '😏',
  unamused: '😒',
  face_with_rolling_eyes: '🙄',
  grimacing: '😬',
  relieved: '😌',
  pensive: '😔',
  sleepy: '😪',
  sleeping: '😴',
  mask: '😷',
  face_with_thermometer: '🤒',
  nerd_face: '🤓',
  sunglasses: '😎',
  confused: '😕',
  worried: '😟',
  slightly_frowning_face: '🙁',
  frowning: '😦',
  anguished: '😧',
  fearful: '😨',
  cold_sweat: '😰',
  disappointed_relieved: '😥',
  sob: '😭',
  scream: '😱',
  confounded: '😖',
  persevere: '😣',
  disappointed: '😞',
  sweat: '😓',
  weary: '😩',
  tired_face: '😫',
  rage: '😡',
  angry: '😠',
  exploding_head: '🤯',
  partying_face: '🥳',
  hugging_face: '🤗',
  face_palm: '🤦',
  shrug: '🤷',
  skull: '💀',
  ghost: '👻',
  robot_face: '🤖',
  clown_face: '🤡',
  // Hands and people
  wave: '👋',
  ok_hand: '👌',
  clap: '👏',
  raised_hands: '🙌',
  muscle: '💪',
  raised_hand: '✋',
  hand: '✋',
  handshake: '🤝',
  point_up: '☝️',
  point_right: '👉',
  point_left: '👈',
  point_down: '👇',
  crossed_fingers: '🤞',
  v: '✌️',
  facepunch: '👊',
  fist: '✊',
  // Hearts and symbols
  heavy_check_mark: '✔️',
  ballot_box_with_check: '☑️',
  x: '❌',
  heavy_multiplication_x: '✖️',
  negative_squared_cross_mark: '❎',
  question: '❓',
  grey_question: '❔',
  exclamation: '❗',
  grey_exclamation: '❕',
  warning: '⚠️',
  no_entry: '⛔',
  no_entry_sign: '🚫',
  star: '⭐',
  star2: '🌟',
  sparkles: '✨',
  zap: '⚡',
  boom: '💥',
  broken_heart: '💔',
  green_heart: '💚',
  blue_heart: '💙',
  yellow_heart: '💛',
  purple_heart: '💜',
  orange_heart: '🧡',
  black_heart: '🖤',
  white_heart: '🤍',
  two_hearts: '💕',
  heavy_plus_sign: '➕',
  heavy_minus_sign: '➖',
  arrow_right: '➡️',
  arrow_left: '⬅️',
  arrow_up: '⬆️',
  arrow_down: '⬇️',
  arrows_counterclockwise: '🔄',
  repeat: '🔁',
  fast_forward: '⏩',
  rewind: '⏪',
  hourglass: '⌛',
  hourglass_flowing_sand: '⏳',
  alarm_clock: '⏰',
  stopwatch: '⏱️',
  clock1: '🕐',
  red_circle: '🔴',
  large_orange_circle: '🟠',
  large_yellow_circle: '🟡',
  large_green_circle: '🟢',
  large_blue_circle: '🔵',
  large_purple_circle: '🟣',
  white_circle: '⚪',
  black_circle: '⚫',
  large_green_square: '🟩',
  large_red_square: '🟥',
  white_square: '◻️',
  black_square: '◼️',
  // Objects
  bulb: '💡',
  memo: '📝',
  pencil: '📝',
  pencil2: '✏️',
  pushpin: '📌',
  round_pushpin: '📍',
  paperclip: '📎',
  calendar: '📆',
  date: '📅',
  clipboard: '📋',
  bookmark: '🔖',
  book: '📖',
  books: '📚',
  page_facing_up: '📄',
  bar_chart: '📊',
  chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉',
  bug: '🐛',
  beetle: '🐞',
  wrench: '🔧',
  hammer: '🔨',
  hammer_and_wrench: '🛠️',
  gear: '⚙️',
  nut_and_bolt: '🔩',
  lock: '🔒',
  unlock: '🔓',
  key: '🔑',
  mag: '🔍',
  bell: '🔔',
  no_bell: '🔕',
  loudspeaker: '📢',
  mega: '📣',
  speech_balloon: '💬',
  thought_balloon: '💭',
  envelope: '✉️',
  email: '📧',
  inbox_tray: '📥',
  outbox_tray: '📤',
  package: '📦',
  moneybag: '💰',
  dollar: '💵',
  credit_card: '💳',
  trophy: '🏆',
  medal: '🏅',
  first_place_medal: '🥇',
  dart: '🎯',
  computer: '💻',
  desktop_computer: '🖥️',
  iphone: '📱',
  phone: '☎️',
  telephone_receiver: '📞',
  camera: '📷',
  movie_camera: '🎥',
  tv: '📺',
  link: '🔗',
  seedling: '🌱',
  evergreen_tree: '🌲',
  construction: '🚧',
  ship: '🚢',
  airplane: '✈️',
  car: '🚗',
  bike: '🚲',
  house: '🏠',
  office: '🏢',
  // Food and drink
  coffee: '☕',
  tea: '🍵',
  beer: '🍺',
  beers: '🍻',
  wine_glass: '🍷',
  cocktail: '🍸',
  champagne: '🍾',
  pizza: '🍕',
  hamburger: '🍔',
  taco: '🌮',
  sushi: '🍣',
  cake: '🍰',
  birthday: '🎂',
  cookie: '🍪',
  doughnut: '🍩',
  apple: '🍎',
  banana: '🍌',
  // Celebration and weather
  gift: '🎁',
  balloon: '🎈',
  confetti_ball: '🎊',
  sunny: '☀️',
  sun_with_face: '🌞',
  cloud: '☁️',
  rain_cloud: '🌧️',
  snowflake: '❄️',
  umbrella: '☔',
  rainbow: '🌈',
  earth_americas: '🌎',
  earth_africa: '🌍',
  earth_asia: '🌏',
  crescent_moon: '🌙',
  // Animals
  cat: '🐱',
  dog: '🐶',
  unicorn_face: '🦄',
  turtle: '🐢',
  snake: '🐍',
  octopus: '🐙',
  bee: '🐝',
  butterfly: '🦋',
  penguin: '🐧',
  monkey_face: '🐵',
  see_no_evil: '🙈',
  hear_no_evil: '🙉',
  speak_no_evil: '🙊',
  // Misc
  zzz: '💤',
  crown: '👑',
  gem: '💎',
  tophat: '🎩',
  dizzy: '💫',
  wave_dash: '〰️',
  hash: '#️⃣',
  zero: '0️⃣',
  one: '1️⃣',
  two: '2️⃣',
  three: '3️⃣',
  four: '4️⃣',
  five: '5️⃣',
  six: '6️⃣',
  seven: '7️⃣',
  eight: '8️⃣',
  nine: '9️⃣',
  keycap_ten: '🔟',
}

/** The three one-click reactions on the hover toolbar, as Slack names. */
export const QUICK_REACTIONS: ReadonlyArray<string> = ['+1', 'white_check_mark', 'eyes']

/** The fixed 12-emoji picker, as Slack names. */
export const PICKER_EMOJI: ReadonlyArray<string> = [
  '+1',
  'heart',
  'joy',
  'tada',
  'eyes',
  'white_check_mark',
  'pray',
  'fire',
  '100',
  'open_mouth',
  'cry',
  'rocket',
]

const skinTones: ReadonlyArray<string> = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']

/**
 * Splits a Slack emoji name into its base name and skin tone, so
 * `+1::skin-tone-3` becomes `{ name: '+1', skinTone: 3 }`.
 */
export function splitEmojiName(raw: string): { readonly name: string; readonly skinTone?: number } {
  const match = /^(.*?)::skin-tone-([2-6])$/.exec(raw)
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return { name: match[1], skinTone: Number(match[2]) }
  }
  return { name: raw }
}

/** Unicode for a Slack emoji name, or `undefined` when it is not in the table. */
export function emojiUnicode(rawName: string): string | undefined {
  const { name, skinTone } = splitEmojiName(rawName)
  const base = table[name]
  if (base === undefined) return undefined
  if (skinTone === undefined) return base
  // Skin tones replace the text-presentation selector, if any.
  return base.replace('️', '') + (skinTones[skinTone - 1] ?? '')
}

/** Converts Slack's hex form ("1f44d-1f3fd") into the unicode string. */
export function unicodeFromHex(hex: string): string | undefined {
  const points = hex.split('-').map((h) => Number.parseInt(h, 16))
  if (points.length === 0 || points.some((p) => Number.isNaN(p) || p < 0 || p > 0x10ffff)) return undefined
  return String.fromCodePoint(...points)
}

/** Whether `name` is a shortcode the table knows. */
export function isKnownEmoji(rawName: string): boolean {
  return emojiUnicode(rawName) !== undefined
}

/**
 * What to show for a reaction name: the unicode, a custom image url, or
 * the name itself when neither is known.
 */
export function reactionDisplay(
  name: string,
  customUrl?: (name: string) => string | undefined,
): { readonly kind: 'unicode'; readonly value: string } | { readonly kind: 'image'; readonly url: string } | { readonly kind: 'name'; readonly value: string } {
  const unicode = emojiUnicode(name)
  if (unicode !== undefined) return { kind: 'unicode', value: unicode }
  const url = customUrl?.(splitEmojiName(name).name)
  if (url !== undefined) return { kind: 'image', url }
  return { kind: 'name', value: name }
}

/** A workspace lookup, including aliases. Missing targets and cycles keep their shortcode. */
export function customEmojiLookup(emojis: ReadonlyArray<CustomEmoji>): (name: string) => string | undefined {
  const byName = new Map(emojis.map((emoji) => [emoji.name, emoji]))
  return (name) => {
    const seen = new Set<string>()
    let current: string | null | undefined = name
    while (current && !seen.has(current)) {
      seen.add(current)
      const emoji = byName.get(current)
      if (emoji?.url) return emoji.url
      current = emoji?.alias_for
    }
    return undefined
  }
}
