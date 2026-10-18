import * as stylex from '@stylexjs/stylex'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import type { KeyboardEvent, ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, EmptyState, Surface } from '@juno/ui'
import { HuddleControls } from './HuddleControls'
import { HuddlePageHeader } from './HuddlePageHeader'
import { PeopleTiles, ShareStage } from './HuddleStage'
import { statusLine } from './look'
import type { HuddleConnection, HuddleControlsActions, HuddleControlsState, HuddleOwnSource, HuddlePerson, HuddlePlace, HuddleShare } from './model'

/** The user is in this huddle. */
export interface HuddleInState extends HuddleControlsState, HuddleControlsActions {
  readonly kind: 'in'
  readonly connection: HuddleConnection
  readonly duration: ReactNode
  /** What the user shares, while `sharing`: a window is previewed, a screen is only named. */
  readonly sharingSource?: HuddleOwnSource
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
  /** The preview of the window the user shares, the same way. Never asked for a screen. */
  readonly renderOwnShare?: () => ReactNode
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
export function HuddlePage({ place, state, people, shares = [], renderShare, renderOwnShare, expandedShare, onExpandShare, onPlace, onOpenThread, devices }: HuddlePageProps) {
  const others = people.filter((person) => person.you !== true)
  const status =
    state.kind === 'in'
      ? statusLine({
          connection: state.connection,
          micBlocked: state.micBlocked ?? false,
          sharers: shares.map((share) => share.ownerName),
          sharing: state.sharing,
          ...(state.sharingSource === undefined ? {} : { sharingSource: state.sharingSource.name }),
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
  const dim = state.kind === 'in' && state.connection === 'reconnecting'
  // Your window shows so you can check it is the right one; a whole screen would show itself without end.
  const own =
    state.kind === 'in' && state.sharing && state.sharingSource?.kind === 'window'
      ? { name: state.sharingSource.name, content: renderOwnShare?.(), onStop: () => state.onShare?.() }
      : undefined
  return (
    <div data-huddle-page="" onKeyDown={onKeyDown} {...stylex.props(styles.root)}>
      <HuddlePageHeader place={place} status={status} spoken={notice ?? announcement ?? ''} onPlace={onPlace} onOpenThread={onOpenThread} />
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
      ) : shares.length > 0 || own !== undefined ? (
        <ShareStage shares={shares} own={own} people={people} renderShare={renderShare} expanded={expanded} onExpandShare={onExpandShare} dim={dim} />
      ) : (
        <PeopleTiles people={people} dim={dim} />
      )}
      <PageFooter state={state} devices={devices} />
    </div>
  )
}

/** The controls in an island, or Join, where a topic's composer sits. Nothing once the huddle is over. */
function PageFooter({ state, devices }: { readonly state: HuddlePageState; readonly devices: ReactNode }) {
  if (state.kind === 'ended' || state.kind === 'failed') return null
  return (
    <footer {...stylex.props(styles.footer)}>
      {state.kind === 'in' ? (
        <Surface kind="island" role="group" aria-label="Huddle controls">
          <ControlsRow state={state} devices={devices} />
        </Surface>
      ) : (
        <Button variant="primary" size="lg" iconStart={Headphones} onClick={state.onJoin}>
          {state.switching === true ? 'Switch to this huddle' : 'Join huddle'}
        </Button>
      )}
    </footer>
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
  empty: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: layout['--header-band'],
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
