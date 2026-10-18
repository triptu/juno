import * as stylex from '@stylexjs/stylex'
import { CornersIn } from '@phosphor-icons/react/dist/icons/CornersIn'
import { CornersOut } from '@phosphor-icons/react/dist/icons/CornersOut'
import { MicrophoneSlash } from '@phosphor-icons/react/dist/icons/MicrophoneSlash'
import type { ReactNode } from 'react'
import { colors, layout, motion, opacity, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, Text, tooltip } from '@juno/ui'
import type { HuddlePerson, HuddleShare } from './model'
import { PersonAvatar } from './Speaking'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'
// Two shares sit side by side from this tab width, one above the other under it. Container queries cannot read tokens.
const STACKED = '@container huddle (width < 720px)'
/** How many people the line under a share shows before "+N". */
const STRIP_MAX = 8

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

export interface ShareStageProps {
  readonly shares: ReadonlyArray<HuddleShare>
  readonly people: ReadonlyArray<HuddlePerson>
  readonly renderShare?: ((id: string) => ReactNode) | undefined
  /** The share given all the room, while two show. */
  readonly expanded?: HuddleShare | undefined
  readonly onExpandShare?: ((id: string | undefined) => void) | undefined
  readonly dim: boolean
}

/** One or two shared screens with the people in a line under them (SPEC 20). */
export function ShareStage({ shares, people, renderShare, expanded, onExpandShare, dim }: ShareStageProps) {
  return (
    <div {...stylex.props(styles.stageArea)}>
      <div {...stylex.props(styles.stage)}>
        {(expanded === undefined ? shares : [expanded]).map((share) => (
          <ShareBox
            key={share.id}
            share={share}
            content={renderShare?.(share.id)}
            expandable={shares.length > 1}
            expanded={expanded !== undefined}
            onExpand={() => onExpandShare?.(expanded === undefined ? share.id : undefined)}
          />
        ))}
      </div>
      <PeopleStrip people={people} dim={dim} />
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

/** The people under a share: a photo, the first name and a slashed microphone when muted, then "+N". */
function PeopleStrip({ people, dim }: { readonly people: ReadonlyArray<HuddlePerson>; readonly dim: boolean }) {
  const shown = people.slice(0, STRIP_MAX)
  const rest = people.length - shown.length
  return (
    <ul aria-label="People in the huddle" {...stylex.props(styles.strip, dim && styles.dim)}>
      {shown.map((person) => {
        const name = person.you === true ? 'You' : (person.name.split(' ')[0] ?? person.name)
        return (
          <li key={person.id} aria-label={person.muted === true ? `${name}, muted` : name} {...stylex.props(styles.chip)}>
            <PersonAvatar person={person} size={20} />
            <Text variant="meta" tone="default" truncate dir="auto">
              {name}
            </Text>
            {person.muted === true ? (
              <span aria-hidden {...stylex.props(styles.chipMuted)}>
                <Icon icon={MicrophoneSlash} size={12} />
              </span>
            ) : null}
          </li>
        )
      })}
      {rest > 0 ? (
        <li {...stylex.props(styles.chip, styles.chipMore)}>
          <Text variant="meta" tone="subtle" numeric>
            +{rest}
          </Text>
        </li>
      ) : null}
    </ul>
  )
}

interface ShareBoxProps {
  readonly share: HuddleShare
  readonly content: ReactNode
  readonly expandable: boolean
  readonly expanded: boolean
  readonly onExpand: () => void
}

/** One shared screen, scaled to fit on a quiet fill, with its owner's name in the corner. */
function ShareBox({ share, content, expandable, expanded, onExpand }: ShareBoxProps) {
  const label = `${share.ownerName}'s screen`
  return (
    <section aria-label={label} data-share={share.id} {...stylex.props(stylex.defaultMarker(), styles.share)}>
      {share.loading === true ? (
        <Text variant="meta" tone="subtle">
          Loading {label}
        </Text>
      ) : (
        <div data-huddle-video={share.id} {...stylex.props(styles.video)}>
          {content}
        </div>
      )}
      <span {...stylex.props(styles.shareLabel)}>{label}</span>
      {expandable ? (
        <button
          type="button"
          aria-label={`${expanded ? 'Shrink' : 'Expand'} ${label}`}
          {...tooltip(expanded ? 'Shrink' : 'Expand', expanded ? 'esc' : undefined)}
          onClick={onExpand}
          {...stylex.props(styles.expand, focusRing.outside)}
        >
          <Icon icon={expanded ? CornersIn : CornersOut} size={16} />
        </button>
      ) : null}
    </section>
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
  stageArea: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    paddingTop: layout['--header-band'],
    paddingInline: spacing['--space-6'],
  },
  stage: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: { default: 'row', [STACKED]: 'column' },
    gap: spacing['--space-3'],
  },
  share: {
    position: 'relative',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--secondary-default'],
  },
  // A size container, so the container's video (or a fixture's picture) can fit itself with `contain`.
  // A block, so the video's 100% width and height resolve to the box and `object-fit: contain` fits it whole.
  video: {
    position: 'absolute',
    inset: 0,
    display: 'block',
  },
  shareLabel: {
    position: 'absolute',
    insetInlineStart: spacing['--space-2'],
    bottom: spacing['--space-2'],
    maxWidth: `calc(100% - ${spacing['--space-4']})`,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    paddingBlock: spacing['--space-0-5'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-pill'],
    backgroundColor: colors['--media-scrim'],
    color: colors['--media-scrim-foreground'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
  },
  // On the picture, so it takes the scrim; shown while the pointer or focus is on the share, and always without a hover pointer.
  expand: {
    appearance: 'none',
    position: 'absolute',
    top: spacing['--space-2'],
    insetInlineEnd: spacing['--space-2'],
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-28'],
    height: sizes['--control-28'],
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--media-scrim'],
    color: colors['--media-scrim-foreground'],
    cursor: 'default',
    opacity: {
      default: 1,
      [HOVER]: { default: 0, ':focus-visible': 1, [stylex.when.ancestor(':hover')]: 1 },
    },
    transitionProperty: 'opacity, scale',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    scale: { default: '1', ':active': motion['--press-scale'] },
  },
  // Wraps to a second line rather than hide anyone; the stage gives up the room.
  strip: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing['--space-1'],
    minHeight: sizes['--control-28'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
    flexShrink: 0,
    transitionProperty: 'opacity',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  // 4px around the 20px photo, so it nests in the pill's round end.
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    height: sizes['--control-28'],
    maxWidth: layout['--huddle-tile-width'],
    paddingInlineStart: spacing['--space-1'],
    paddingInlineEnd: spacing['--space-2-5'],
    boxSizing: 'border-box',
    borderRadius: radii['--radius-pill'],
    backgroundColor: colors['--secondary-default'],
  },
  chipMore: {
    paddingInlineStart: spacing['--space-2-5'],
  },
  chipMuted: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
  },
})
