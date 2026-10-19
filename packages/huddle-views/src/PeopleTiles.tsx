import * as stylex from '@stylexjs/stylex'
import { MicrophoneSlash } from '@phosphor-icons/react/dist/icons/MicrophoneSlash'
import { colors, layout, motion, opacity, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, Text } from '@juno/ui'
import type { HuddlePerson } from './model'
import { PersonAvatar } from './Speaking'

export interface PeopleTilesProps {
  /** Everyone in the huddle, the user first. */
  readonly people: ReadonlyArray<HuddlePerson>
  /** The connection is down: the tiles dim. */
  readonly dim: boolean
}

/** Audio only (SPEC 20): a tile per person, centred in the room between the header and the controls. */
export function PeopleTiles({ people, dim }: PeopleTilesProps) {
  return (
    <div {...stylex.props(styles.tilesArea)}>
      <ul aria-label="People in the huddle" {...stylex.props(styles.tiles, dim && styles.dim)}>
        {people.map((person) => (
          <Tile key={person.id} person={person} />
        ))}
      </ul>
    </div>
  )
}

function Tile({ person }: { readonly person: HuddlePerson }) {
  const name = person.you === true ? 'You' : person.name
  return (
    <li aria-label={person.muted === true ? `${name}, muted` : name} data-speaking={person.speaking === true ? '' : undefined} {...stylex.props(styles.tile, person.speaking === true && styles.tileSpeaking)}>
      <PersonAvatar person={person} size={44} showSpeaking={false} />
      <Text variant="ui" weight="medium" tone="default" truncate dir="auto" sx={styles.tileName}>
        {name}
      </Text>
      {person.muted === true ? (
        <span aria-hidden {...stylex.props(styles.tileMuted)}>
          <Icon icon={MicrophoneSlash} size={14} />
        </span>
      ) : null}
    </li>
  )
}

const styles = stylex.create({
  // The tiles centred in the room between the header and the controls; they scroll under the header when there are many.
  tilesArea: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingTop: layout['--header-band'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-4'],
  },
  tiles: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'center',
    gap: spacing['--space-3'],
    width: '100%',
    maxWidth: layout['--page-width'],
    margin: 'auto',
    padding: 0,
    listStyle: 'none',
    transitionProperty: 'opacity',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  dim: {
    opacity: opacity['--opacity-dim'],
  },
  tile: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing['--space-2'],
    width: layout['--huddle-tile-width'],
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-3'],
    boxSizing: 'border-box',
    borderRadius: radii['--radius-3xl'],
    backgroundColor: colors['--secondary-default'],
    outlineStyle: 'solid',
    outlineWidth: sizes['--speaking-ring'],
    outlineOffset: `calc(-1 * ${sizes['--speaking-ring']})`,
    outlineColor: 'transparent',
    transitionProperty: 'outline-color',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
  },
  tileSpeaking: {
    outlineColor: colors['--huddle-live'],
  },
  tileName: {
    maxWidth: '100%',
  },
  tileMuted: {
    position: 'absolute',
    top: spacing['--space-2-5'],
    insetInlineEnd: spacing['--space-2-5'],
    display: 'inline-flex',
    color: colors['--foreground-subtle'],
  },
})
