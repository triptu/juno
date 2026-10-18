import * as stylex from '@stylexjs/stylex'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { MicrophoneSlash } from '@phosphor-icons/react/dist/icons/MicrophoneSlash'
import { MonitorArrowUp } from '@phosphor-icons/react/dist/icons/MonitorArrowUp'
import { PhoneX } from '@phosphor-icons/react/dist/icons/PhoneX'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/icons/SlidersHorizontal'
import type { ReactNode } from 'react'
import { colors, radii, spacing } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton, Popover, type PhosphorIcon } from '@juno/ui'
import { islandText } from './islandText'
import type { HuddleControlsActions, HuddleControlsState } from './model'

/** Mute and unmute while Juno is the active app (SPEC 20). The app menu owns the accelerator. */
export const muteShortcut = '⌘⇧Space'

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
        <Fills shape={shape}>
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
                size={28}
                iconSize={16}
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
  readonly icon: PhosphorIcon
  readonly label: string
  readonly onClick: () => void
}

/** A 28px text button with the island controls' fills: Leave, and the tab header's Thread. */
export function TextControl({ shape, icon, label, onClick }: TextControlProps) {
  return (
    <button type="button" onClick={onClick} {...stylex.props(islandText.base, focusRing.outside, shape === 'bar' ? styles.textBar : styles.textIsland)}>
      <span {...stylex.props(islandText.icon)}>
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
  barFills: {
    display: 'contents',
    '--secondary-default': colors['--huddle-bar-hover'],
    '--secondary-hover': colors['--huddle-bar-pressed'],
    '--secondary-active': colors['--huddle-bar-pressed-hover'],
  },
  textBar: { borderRadius: radii['--radius-lg'] },
  textIsland: { borderRadius: radii['--radius-pill'] },
})
