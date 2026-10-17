import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import {
  Button,
  ChannelIcon,
  channelColorNames,
  channelIconNames,
  channelIcons,
  IconButton,
  radioItem,
  radioKeys,
  Swatch,
  Text,
  type ChannelColorName,
  type ChannelIconName,
} from '@juno/ui'

export interface ChannelIconPickerProps {
  /** The channel name without "#". Its first letter is the "no icon" choice. */
  readonly name: string
  /** The chosen icon, or unset for the first letter. */
  readonly icon?: ChannelIconName
  readonly color: ChannelColorName
  readonly onIconChange: (icon: ChannelIconName | undefined) => void
  readonly onColorChange: (color: ChannelColorName) => void
}

const colorLabels: Record<ChannelColorName, string> = {
  cyan: 'Cyan',
  claret: 'Claret',
  midnight: 'Midnight',
  emeraldDark: 'Dark emerald',
  plum: 'Plum',
  rose: 'Rose',
  emerald: 'Emerald',
  jordy: 'Jordy blue',
}

const iconLabels: Record<ChannelIconName, string> = {
  hash: 'Hash',
  megaphone: 'Megaphone',
  chats: 'Chats',
  rocket: 'Rocket',
  code: 'Code',
  bug: 'Bug',
  wrench: 'Wrench',
  flask: 'Flask',
  shield: 'Shield',
  lightning: 'Lightning',
  globe: 'Globe',
  compass: 'Compass',
  flag: 'Flag',
  star: 'Star',
  heart: 'Heart',
  leaf: 'Leaf',
  coffee: 'Coffee',
  gift: 'Gift',
  trophy: 'Trophy',
  book: 'Book',
  briefcase: 'Briefcase',
  calendar: 'Calendar',
  camera: 'Camera',
  truck: 'Truck',
}

/**
 * Change a channel's icon and colour: the tile as it will look, the eight
 * colours, then the first letter and the twenty-four icons. Every change
 * goes straight to the owner; there is no Save. Opens from the channel
 * context menu ("Change icon and colour").
 */
export function ChannelIconPicker({ name, icon, color, onIconChange, onColorChange }: ChannelIconPickerProps) {
  return (
    <div {...stylex.props(styles.root)} role="group" aria-label={`Icon and colour for ${name}`}>
      <div {...stylex.props(styles.preview)}>
        <ChannelIcon name={name} icon={icon} color={color} size={44} />
        <Text variant="body" weight="medium" tone="default">
          {name}
        </Text>
      </div>
      <div {...stylex.props(styles.section)}>
        <Text variant="sectionLabel" tone="muted">
          Colour
        </Text>
        <div {...stylex.props(styles.colors)} role="radiogroup" aria-label="Colour" onKeyDown={radioKeys}>
          {channelColorNames.map((option) => (
            <Swatch key={option} hue={option} label={colorLabels[option]} selected={option === color} {...radioItem(option === color, option === color)} onClick={() => onColorChange(option)} />
          ))}
        </div>
      </div>
      <div {...stylex.props(styles.section)}>
        <Text variant="sectionLabel" tone="muted">
          Icon
        </Text>
        <div {...stylex.props(styles.icons)} role="radiogroup" aria-label="Icon" onKeyDown={radioKeys}>
          <Button variant="ghost" size="lg" pressed={icon === undefined} {...radioItem(icon === undefined, icon === undefined)} aria-label="First letter" title="First letter" onClick={() => onIconChange(undefined)}>
            {name.slice(0, 1).toUpperCase()}
          </Button>
          {channelIconNames.map((option) => (
            <IconButton
              key={option}
              icon={channelIcons[option]}
              label={iconLabels[option]}
              size={32}
              pressed={option === icon}
              {...radioItem(option === icon, option === icon)}
              onClick={() => onIconChange(option)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-4'],
    userSelect: 'none',
  },
  preview: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  colors: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
    paddingInline: spacing['--space-0-5'],
  },
  icons: {
    display: 'grid',
    // The letter plus 24 icons: five rows of five.
    gridTemplateColumns: 'repeat(5, auto)',
    justifyContent: 'start',
    gap: spacing['--space-1'],
  },
})
