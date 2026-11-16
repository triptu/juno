import * as stylex from '@stylexjs/stylex'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { MicrophoneSlash } from '@phosphor-icons/react/dist/icons/MicrophoneSlash'
import { MonitorArrowUp } from '@phosphor-icons/react/dist/icons/MonitorArrowUp'
import { PhoneX } from '@phosphor-icons/react/dist/icons/PhoneX'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/icons/SlidersHorizontal'
import type { ReactNode } from 'react'
import { colors, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { focusRing, handWrittenKeys, Icon, IconButton, type PhosphorIcon, Popover } from '@juno/ui'
import { islandText } from './islandText'
import { microphoneCopy } from './look'
import type { HuddleControlsActions, HuddleControlsState } from './model'

/** Mute and unmute while Juno is the active app (SPEC 20). The app menu owns the accelerator. */
// The page takes the key itself (SPEC 20). Windows uses Ctrl+Shift+Space: Win+Shift+Space switches the keyboard language there.
export const muteShortcut = handWrittenKeys('⌘⇧Space', 'CommandOrControl+Shift+Space')

/**
 * `bar`: the sidebar bar's row, 28px rounded rectangles that nest in its
 * 12px corners. `island`: the tab's control island at the bottom, round, as
 * the header islands' controls are, one size up (32px) since it is the
 * tab's main control.
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
  microphone,
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
  const size = shape === 'bar' ? 28 : 32
  const iconSize = shape === 'bar' ? 16 : 18
  return (
    <>
      <span {...stylex.props(styles.group)}>
        <Fills shape={shape}>
          {/* Whenever nobody can hear you, Mute is red with the slashed microphone, so muted reads at a glance. */}
          {microphone === 'blocked' ? (
            <IconButton icon={MicrophoneSlash} label={microphoneCopy.blocked.tooltip} size={size} iconSize={iconSize} radius={radius} variant="island" alert onClick={onOpenMicSettings} />
          ) : microphone !== undefined ? (
            <IconButton icon={MicrophoneSlash} label={microphoneCopy[microphone].tooltip} size={size} iconSize={iconSize} radius={radius} variant="island" alert dimmed />
          ) : (
            <IconButton icon={muted ? MicrophoneSlash : Microphone} label="Mute" shortcut={muteShortcut} size={size} iconSize={iconSize} radius={radius} variant="island" pressed={muted} alert={muted} onClick={onMute} />
          )}
          {canShare ? (
            shareFull && !sharing ? (
              <IconButton icon={MonitorArrowUp} label="Two people are sharing already" size={size} iconSize={iconSize} radius={radius} variant="island" dimmed />
            ) : (
              <IconButton icon={MonitorArrowUp} label={sharing ? 'Stop sharing' : 'Share screen'} size={size} iconSize={iconSize} radius={radius} variant="island" pressed={sharing} onClick={onShare} />
            )
          ) : null}
        </Fills>
        <Popover
          open={devicesOpen && devices !== undefined}
          onClose={() => onDevices(false)}
          placement={shape === 'bar' ? 'bottom-start' : 'top-start'}
          width="browse"
          role="menu"
          label="Microphone and speaker"
          anchor={
            <Fills shape={shape}>
              <IconButton
                icon={SlidersHorizontal}
                label="Microphone and speaker"
                size={size}
                iconSize={iconSize}
                radius={radius}
                variant="island"
                aria-haspopup="menu"
                expanded={devicesOpen}
                onClick={() => onDevices(!devicesOpen)}
              />
            </Fills>
          }
        >
          {devices}
        </Popover>
      </span>
      <Fills shape={shape}>
        <LeaveButton shape={shape} onLeave={onLeave} />
      </Fills>
    </>
  )
}

/**
 * In the bar, the controls' hover and pressed fills are steps of the bar's
 * accent tint. Set around each control, not the row, so the device menu that
 * opens inside the row keeps its own fills.
 */
function Fills({ shape, children }: { readonly shape: ControlsShape; readonly children: ReactNode }) {
  return shape === 'bar' ? <span {...stylex.props(styles.barFills)}>{children}</span> : children
}

interface TextControlProps {
  readonly shape: ControlsShape
  /** The tab's control island draws it one size up, as its icon buttons. Default 28. */
  readonly size?: 28 | 32
  readonly icon: PhosphorIcon
  /** The green filled headphones of Join, as the header's Join has them: a huddle runs here. */
  readonly live?: boolean
  readonly label: string
  readonly onClick: () => void
}

/** A text button with the island controls' fills: Leave, and the tab's Join huddle. */
export function TextControl({ shape, size = 28, icon, live = false, label, onClick }: TextControlProps) {
  return (
    <button type="button" onClick={onClick} {...stylex.props(islandText.base, focusRing.outside, shape === 'bar' ? styles.textBar : styles.textIsland, size === 32 && styles.text32)}>
      <span {...stylex.props(islandText.icon, live && styles.live)}>
        <Icon icon={icon} size={size === 32 ? 16 : 14} {...(live ? { weight: 'fill' as const } : {})} />
      </span>
      {label}
    </button>
  )
}

function LeaveButton({ shape, onLeave }: { readonly shape: ControlsShape; readonly onLeave: () => void }) {
  return <TextControl shape={shape} size={shape === 'bar' ? 28 : 32} icon={PhoneX} label="Leave" onClick={onLeave} />
}

const styles = stylex.create({
  group: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
  },
  barFills: {
    display: 'contents',
    '--secondary-default': colors['--huddle-bar-hover'],
    '--secondary-hover': colors['--huddle-bar-pressed'],
    '--secondary-active': colors['--huddle-bar-pressed-hover'],
  },
  live: { color: colors['--huddle-live'] },
  textBar: { borderRadius: radii['--radius-lg'] },
  textIsland: { borderRadius: radii['--radius-pill'] },
  // One size up from 28: the height, the inset and the type step together.
  text32: {
    height: sizes['--control-32'],
    minWidth: sizes['--control-32'],
    paddingInline: spacing['--space-3'],
    fontSize: text['--text-ui-size'],
  },
})
