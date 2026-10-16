import * as stylex from '@stylexjs/stylex'
import { Book } from '@phosphor-icons/react/dist/icons/Book'
import { Briefcase } from '@phosphor-icons/react/dist/icons/Briefcase'
import { Bug } from '@phosphor-icons/react/dist/icons/Bug'
import { Calendar } from '@phosphor-icons/react/dist/icons/Calendar'
import { Camera } from '@phosphor-icons/react/dist/icons/Camera'
import { Chats } from '@phosphor-icons/react/dist/icons/Chats'
import { Code } from '@phosphor-icons/react/dist/icons/Code'
import { Coffee } from '@phosphor-icons/react/dist/icons/Coffee'
import { Compass } from '@phosphor-icons/react/dist/icons/Compass'
import { Flag } from '@phosphor-icons/react/dist/icons/Flag'
import { Flask } from '@phosphor-icons/react/dist/icons/Flask'
import { Gift } from '@phosphor-icons/react/dist/icons/Gift'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Heart } from '@phosphor-icons/react/dist/icons/Heart'
import { Leaf } from '@phosphor-icons/react/dist/icons/Leaf'
import { Lightning } from '@phosphor-icons/react/dist/icons/Lightning'
import { Megaphone } from '@phosphor-icons/react/dist/icons/Megaphone'
import { Rocket } from '@phosphor-icons/react/dist/icons/Rocket'
import { Shield } from '@phosphor-icons/react/dist/icons/Shield'
import { Star } from '@phosphor-icons/react/dist/icons/Star'
import { Trophy } from '@phosphor-icons/react/dist/icons/Trophy'
import { Truck } from '@phosphor-icons/react/dist/icons/Truck'
import { Wrench } from '@phosphor-icons/react/dist/icons/Wrench'
import { radii, weights } from '@juno/tokens/tokens.stylex'
import { tileSizes } from './internal/tileSizes'
import { hueStyles, type AvatarSize } from './Avatar'
import { Icon, type IconSize, type PhosphorIcon } from './Icon'
import { firstGrapheme } from './internal/grapheme'
import { hueForId, hueNames, type HueName } from './internal/hue'

/**
 * The icons a user can pick for a channel. Twenty-four plain objects that
 * read at 16px; nothing that collides with chrome (no bell, pin, check,
 * search). Keyed by a stable name that is what gets stored.
 */
export const channelIcons = {
  hash: Hash,
  megaphone: Megaphone,
  chats: Chats,
  rocket: Rocket,
  code: Code,
  bug: Bug,
  wrench: Wrench,
  flask: Flask,
  shield: Shield,
  lightning: Lightning,
  globe: Globe,
  compass: Compass,
  flag: Flag,
  star: Star,
  heart: Heart,
  leaf: Leaf,
  coffee: Coffee,
  gift: Gift,
  trophy: Trophy,
  book: Book,
  briefcase: Briefcase,
  calendar: Calendar,
  camera: Camera,
  truck: Truck,
} as const satisfies Record<string, PhosphorIcon>

export type ChannelIconName = keyof typeof channelIcons
export const channelIconNames = Object.keys(channelIcons) as ReadonlyArray<ChannelIconName>

/** The colours a user can pick for a channel: the eight person hues. */
export type ChannelColorName = HueName
export const channelColorNames: ReadonlyArray<ChannelColorName> = hueNames

export interface ChannelIconProps {
  /** The channel name without "#". Its first character (a whole emoji, never half of one) is the default glyph. */
  readonly name: string
  /** The chosen icon; unset shows the first letter. */
  readonly icon?: ChannelIconName
  /** The chosen colour. Default: `hueForId(id)` when `id` is given, else rose. */
  readonly color?: ChannelColorName
  /** The channel id, for the deterministic default colour. */
  readonly id?: string
  readonly size?: ChannelIconSize
  /** Accessible name. Omit when the name is visible next to the tile. */
  readonly label?: string
}

/** The avatar sizes but the tab's 16, which only people take. */
export type ChannelIconSize = Exclude<AvatarSize, 16>

const iconBySize: Record<ChannelIconSize, IconSize> = { 44: 20, 36: 18, 32: 16, 28: 15, 24: 13, 20: 12, 18: 12 }

/**
 * A square tile for a channel: a chosen Phosphor icon, or the first letter,
 * on a chosen colour. The same hue mix as avatars, so a channel tile and a
 * person's initials sit together in a row.
 */
export function ChannelIcon({ name, icon, color, id, size = 44, label }: ChannelIconProps) {
  const hue = color ?? (id === undefined ? 'rose' : hueForId(id))
  const Glyph = icon === undefined ? undefined : channelIcons[icon]
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...stylex.props(styles.tile, tileSizes[size], tileRadius[size], hueStyles[hue])}
    >
      {Glyph ? <Icon icon={Glyph} size={iconBySize[size]} /> : firstGrapheme(name)}
    </span>
  )
}

const styles = stylex.create({
  tile: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontWeight: weights['--weight-semibold'],
    lineHeight: 1,
    letterSpacing: 0,
    textTransform: 'uppercase',
    userSelect: 'none',
    verticalAlign: 'middle',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
})

// Tile radius follows the nesting rule against the row it sits in.
const tileRadius = stylex.create({
  44: { borderRadius: radii['--radius-3xl'] },
  36: { borderRadius: radii['--radius-xl'] },
  32: { borderRadius: radii['--radius-xl'] },
  28: { borderRadius: radii['--radius-lg'] },
  24: { borderRadius: radii['--radius-md-plus'] },
  20: { borderRadius: radii['--radius-md'] },
  18: { borderRadius: radii['--radius-sm'] },
})
