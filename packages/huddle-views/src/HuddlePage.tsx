import * as stylex from '@stylexjs/stylex'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { CornersIn } from '@phosphor-icons/react/dist/icons/CornersIn'
import { CornersOut } from '@phosphor-icons/react/dist/icons/CornersOut'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import { MicrophoneSlash } from '@phosphor-icons/react/dist/icons/MicrophoneSlash'
import type { KeyboardEvent, ReactNode } from 'react'
import { colors, layout, motion, opacity, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { Button, ContextPill, EmptyState, focusRing, HeaderBand, Icon, Surface, Text, tooltip } from '@juno/ui'
import { HuddleControls, TextControl } from './HuddleControls'
import { placeIcons, placeKindLabels, placeTints, statusLine } from './look'
import type { HuddleConnection, HuddleControlsActions, HuddleControlsState, HuddlePerson, HuddlePlace, HuddleShare } from './model'
import { PersonAvatar } from './Speaking'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'
// Two shares sit side by side from this tab width, one above the other under it. Container queries cannot read tokens.
const STACKED = '@container huddle (width < 720px)'
/** How many people the line under a share shows before "+N". */
const STRIP_MAX = 8

/** The user is in this huddle. */
export interface HuddleInState extends HuddleControlsState, HuddleControlsActions {
  readonly kind: 'in'
  readonly connection: HuddleConnection
  readonly duration: ReactNode
  /** What the user shares ("Entire screen", a window's name), while `sharing`. */
  readonly sharingSource?: string
  /** Said once to a screen reader: "Maya joined", "Muted". The status line's notices are said too; the duration never is. */
  readonly announcement?: string
}

/** The huddle runs and the user is not in it. `switching`: they are in another, so Join leaves it. */
export interface HuddleOutState {
  readonly kind: 'out'
  readonly duration: ReactNode
  readonly switching?: boolean
  readonly onJoin: () => void
}

export interface HuddleEndedState {
  readonly kind: 'ended'
  /** "24 minutes". */
  readonly lasted: string
}

export interface HuddleFailedState {
  readonly kind: 'failed'
  /** One or two sentences: "This huddle is full." */
  readonly reason: string
  /** Absent when trying again cannot work (huddles are turned off in the workspace). */
  readonly onRetry?: () => void
}

export type HuddlePageState = HuddleInState | HuddleOutState | HuddleEndedState | HuddleFailedState

export interface HuddlePageProps {
  readonly place: HuddlePlace
  readonly state: HuddlePageState
  /** Everyone in the huddle, the user first when they are in it, then in join order. */
  readonly people: ReadonlyArray<HuddlePerson>
  /** Others' shared screens, at most two. */
  readonly shares?: ReadonlyArray<HuddleShare>
  /** The video for a share: the container's element, filling the box (`object-fit: contain`). */
  readonly renderShare?: (id: string) => ReactNode
  /** The share given all the room, while two show. */
  readonly expandedShare?: string
  readonly onExpandShare?: (id: string | undefined) => void
  /** Narrows the sidebar to the channel, as the topic header's pill does. */
  readonly onPlace?: () => void
  /** Opens the huddle's thread. Absent until Slack has made it. */
  readonly onOpenThread?: () => void
  /** The device menu's content, shown while `devicesOpen`. */
  readonly devices?: ReactNode
}

/**
 * The huddle tab (SPEC 20): the page header's islands with the place, the
 * title and the status line, and Thread; then who is in the huddle as
 * tiles, or the shared screens with the people in a line under them; then
 * the controls in an island where a topic's composer sits.
 */
export function HuddlePage({ place, state, people, shares = [], renderShare, expandedShare, onExpandShare, onPlace, onOpenThread, devices }: HuddlePageProps) {
  const others = people.filter((person) => person.you !== true)
  const live = state.kind === 'in' || state.kind === 'out'
  const status =
    state.kind === 'in'
      ? statusLine({
          connection: state.connection,
          micBlocked: state.micBlocked ?? false,
          sharers: shares.map((share) => share.ownerName),
          sharing: state.sharing,
          ...(state.sharingSource === undefined ? {} : { sharingSource: state.sharingSource }),
          alone: others.length === 0,
          duration: state.duration,
        })
      : state.kind === 'out'
        ? statusLine({ connection: 'live', sharers: shares.map((share) => share.ownerName), duration: state.duration })
        : undefined
  const duration = state.kind === 'in' || state.kind === 'out' ? state.duration : undefined
  const notice = status !== duration ? status : undefined
  const announcement = state.kind === 'in' ? state.announcement : undefined
  const expanded = shares.find((share) => share.id === expandedShare)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || expanded === undefined) return
    event.preventDefault()
    onExpandShare?.(undefined)
  }
  return (
    <div data-huddle-page="" onKeyDown={onKeyDown} {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.header)}>
        <HeaderBand />
        <div {...stylex.props(styles.islands)}>
          <Surface kind="island" data-island="left" sx={styles.left}>
            <ContextPill
              size={24}
              tint={placeTints[place.kind]}
              icon={placeIcons[place.kind]}
              name={place.name}
              kindLabel={placeKindLabels[place.kind]}
              label={`${place.name}, ${placeKindLabels[place.kind].toLowerCase()}. Show in sidebar.`}
              {...(onPlace === undefined ? {} : { onClick: onPlace })}
            />
            <h1 {...stylex.props(styles.title)}>Huddle</h1>
            {status === undefined ? null : (
              <Text variant="meta" tone="muted" numeric truncate sx={styles.status}>
                {status}
              </Text>
            )}
            <span role="status" {...stylex.props(styles.announce)}>
              {notice ?? announcement ?? ''}
            </span>
          </Surface>
          {onOpenThread === undefined ? null : (
            <Surface kind="island" data-island="right" sx={styles.right}>
              <TextControl shape="island" icon={ChatsCircle} label="Thread" onClick={onOpenThread} />
            </Surface>
          )}
        </div>
      </header>

      {state.kind === 'ended' ? (
        <div {...stylex.props(styles.empty)}>
          <EmptyState
            variant="workspace"
            title="The huddle ended"
            body={`It lasted ${state.lasted}.`}
            action={onOpenThread === undefined ? undefined : <Button onClick={onOpenThread}>Open thread</Button>}
          />
        </div>
      ) : state.kind === 'failed' ? (
        <div {...stylex.props(styles.empty)}>
          <EmptyState variant="workspace" title="Couldn't join the huddle" body={state.reason} action={state.onRetry === undefined ? undefined : <Button onClick={state.onRetry}>Try again</Button>} />
        </div>
      ) : shares.length > 0 ? (
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
          <PeopleStrip people={people} dim={state.kind === 'in' && state.connection === 'reconnecting'} />
        </div>
      ) : (
        <div {...stylex.props(styles.tilesArea)}>
          <ul aria-label="People in the huddle" {...stylex.props(styles.tiles, state.kind === 'in' && state.connection === 'reconnecting' && styles.dim)}>
            {people.map((person) => (
              <Tile key={person.id} person={person} />
            ))}
          </ul>
        </div>
      )}

      {live ? (
        <footer {...stylex.props(styles.footer)}>
          {state.kind === 'in' ? (
            <Surface kind="island" role="group" aria-label="Huddle controls">
              <ControlsRow state={state} devices={devices} />
            </Surface>
          ) : state.kind === 'out' ? (
            <Button variant="primary" size="lg" iconStart={Headphones} onClick={state.onJoin}>
              {state.switching === true ? 'Switch to this huddle' : 'Join huddle'}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </div>
  )
}

function ControlsRow({ state, devices }: { readonly state: HuddleInState; readonly devices: ReactNode }) {
  const { kind: _kind, connection: _connection, duration: _duration, sharingSource: _source, ...controls } = state
  // Leave stands a little apart from the toggles: it ends the call, they change it.
  return (
    <span {...stylex.props(styles.controlsInner)}>
      <HuddleControls shape="island" devices={devices} {...controls} />
    </span>
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
  // A width container named for the two-share query, and the frame for the out-of-flow header.
  root: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minHeight: 0,
    backgroundColor: colors['--background'],
    color: colors['--foreground-default'],
    containerType: 'inline-size',
    containerName: 'huddle',
    userSelect: 'none',
  },
  header: {
    position: 'absolute',
    top: 0,
    insetInline: 0,
    height: layout['--header-band'],
    pointerEvents: 'none',
  },
  // The page's edges: the same 24px the stage keeps, so the islands line up with the shares.
  islands: {
    position: 'absolute',
    top: layout['--header-island-top'],
    insetInline: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    pointerEvents: 'none',
  },
  // The pill sits 2px further in than the island's even inset, so its round end clears the island's (HeaderIslands).
  left: {
    flexShrink: 1,
    minWidth: 0,
    paddingInlineStart: `calc((${layout['--header-island-height']} - ${sizes['--control-28']}) / 2 - 1px + ${spacing['--space-0-5']})`, // tokens-allow: Subtract the 1px island border from the inset.
    paddingInlineEnd: spacing['--space-3'],
    pointerEvents: 'auto',
  },
  right: {
    flexShrink: 0,
    pointerEvents: 'auto',
  },
  title: {
    flexShrink: 0,
    margin: 0,
    paddingInline: spacing['--space-2'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-body-small-size'],
    fontWeight: weights['--weight-semibold'],
    lineHeight: sizes['--control-28'],
  },
  status: {
    minWidth: 0,
  },
  // Heard, not seen: what changed, never the ticking duration.
  announce: {
    position: 'absolute',
    width: '1px', // tokens-allow: the visually hidden pattern
    height: '1px', // tokens-allow: the visually hidden pattern
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
  empty: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: layout['--header-band'],
  },
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
  footer: {
    display: 'flex',
    justifyContent: 'center',
    flexShrink: 0,
    paddingTop: spacing['--space-3'],
    paddingBottom: spacing['--space-4'],
    paddingInline: spacing['--space-6'],
  },
  controlsInner: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
})
