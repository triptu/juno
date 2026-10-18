import * as stylex from '@stylexjs/stylex'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { MicrophoneSlash } from '@phosphor-icons/react/dist/icons/MicrophoneSlash'
import { MonitorArrowUp } from '@phosphor-icons/react/dist/icons/MonitorArrowUp'
import { PhoneX } from '@phosphor-icons/react/dist/icons/PhoneX'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/icons/SlidersHorizontal'
import type { ReactNode } from 'react'
import { colors, motion, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton, Popover, type PhosphorIcon } from '@juno/ui'
import type { HuddleControlsActions, HuddleControlsState } from './model'

/** Mute and unmute while Juno is the active app (SPEC 20). The app menu owns the accelerator. */
export const muteShortcut = '⌘⇧Space'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

/**
 * `bar`: the sidebar bar's row, rounded rectangles that nest in its 12px
 * corners. `island`: the tab's control island at the bottom, round, as the
 * header islands' controls are.
 */
export type ControlsShape = 'bar' | 'island'

export interface HuddleControlsProps extends HuddleControlsState, HuddleControlsActions {
  readonly shape: ControlsShape
  /** The device menu's content (`HuddleDeviceMenu`), shown while `devicesOpen`. */
  readonly devices?: ReactNode
}

/**
 * Mute, Share screen and Microphone and speaker, then Leave: the same
 * controls in the bar and the tab, with the same names and tooltips.
 * Share screen takes no room until it is offered.
 */
export function HuddleControls({
  shape,
  muted,
  micBlocked = false,
  sharing,
  canShare = false,
  shareFull = false,
  devicesOpen,
  devices,
  onMute,
  onOpenMicSettings,
  onShare,
  onDevices,
  onLeave,
}: HuddleControlsProps) {
  const radius = shape === 'bar' ? 'lg' : 'full'
  return (
    <>
      <span {...stylex.props(styles.group)}>
        {micBlocked ? (
          <IconButton icon={MicrophoneSlash} label="Allow the microphone in System Settings" size={28} iconSize={16} radius={radius} variant="island" onClick={onOpenMicSettings} />
        ) : (
          <IconButton icon={muted ? MicrophoneSlash : Microphone} label="Mute" shortcut={muteShortcut} size={28} iconSize={16} radius={radius} variant="island" pressed={muted} onClick={onMute} />
        )}
        {canShare ? (
          shareFull && !sharing ? (
            <IconButton icon={MonitorArrowUp} label="Two people are sharing already" size={28} iconSize={16} radius={radius} variant="island" dimmed />
          ) : (
            <IconButton icon={MonitorArrowUp} label={sharing ? 'Stop sharing' : 'Share screen'} size={28} iconSize={16} radius={radius} variant="island" pressed={sharing} onClick={onShare} />
          )
        ) : null}
        <Popover
          open={devicesOpen && devices !== undefined}
          onClose={() => onDevices(false)}
          placement={shape === 'bar' ? 'bottom-start' : 'top-start'}
          width="browse"
          role="menu"
          label="Microphone and speaker"
          anchor={
            <IconButton
              icon={SlidersHorizontal}
              label="Microphone and speaker"
              size={28}
              iconSize={16}
              radius={radius}
              variant="island"
              aria-haspopup="menu"
              expanded={devicesOpen}
              onClick={() => onDevices(!devicesOpen)}
            />
          }
        >
          {devices}
        </Popover>
      </span>
      <LeaveButton shape={shape} onLeave={onLeave} />
    </>
  )
}

interface TextControlProps {
  readonly shape: ControlsShape
  readonly icon: PhosphorIcon
  readonly label: string
  readonly onClick: () => void
}

/** A 28px text button with the island controls' fills: Leave, and the tab header's Thread. */
export function TextControl({ shape, icon, label, onClick }: TextControlProps) {
  return (
    <button type="button" onClick={onClick} {...stylex.props(styles.text, focusRing.outside, shape === 'bar' ? styles.textBar : styles.textIsland)}>
      <span {...stylex.props(styles.textIcon)}>
        <Icon icon={icon} size={14} />
      </span>
      {label}
    </button>
  )
}

function LeaveButton({ shape, onLeave }: { readonly shape: ControlsShape; readonly onLeave: () => void }) {
  return <TextControl shape={shape} icon={PhoneX} label="Leave" onClick={onLeave} />
}

const styles = stylex.create({
  group: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
  },
  // The element reset and the island controls' feedback, as IconButton's `island` variant draws it.
  text: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing['--space-1-5'],
    height: sizes['--control-28'],
    margin: 0,
    paddingBlock: 0,
    paddingInline: spacing['--space-2-5'],
    boxSizing: 'border-box',
    borderWidth: 0,
    color: colors['--foreground-default'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    cursor: 'default',
    WebkitAppRegion: 'no-drag',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
      ':active': { default: colors['--secondary-default'], [HOVER]: colors['--secondary-default'] },
    },
    transitionProperty: 'scale, background-color',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
    scale: { default: '1', ':active': motion['--press-scale'] },
  },
  textBar: { borderRadius: radii['--radius-lg'] },
  textIsland: { borderRadius: radii['--radius-pill'] },
  textIcon: {
    display: 'inline-flex',
    color: colors['--foreground-subtle'],
  },
})
