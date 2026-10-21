import { menuTriggerHandlers } from './menuTrigger'
import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes } from 'react'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { Avatar, type HueName } from './Avatar'
import { focusRing } from './focusRing'
import { PresenceDot } from './PresenceDot'
import { interactive } from './internal/interactive'
import { tooltip } from './Tooltip'

export interface AvatarButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  /** Required accessible name, for example "Account and settings". */
  readonly label: string
  /** The initials to draw while the photo loads or when there is none. */
  readonly initials: string
  readonly hue?: HueName
  /** The profile photo. */
  readonly src?: string
  /** The menu it opens is open. Sets aria-expanded and keeps the hover fill. */
  readonly open?: boolean
  /** Whether Slack shows you as active, drawn as a dot on the avatar's corner. Omitted while unknown. */
  readonly presence?: 'active' | 'away'
  /** "Paused until 9am" while notifications are paused: the dot becomes a moon and the description says so. */
  readonly paused?: string
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

/**
 * The title bar's account button: a 24px avatar inside a 30px round ghost
 * button. Instant hover fill and the keyboard focus ring come from the
 * shared interactive styles. With `presence`, a dot on the avatar's corner
 * shows whether Slack shows you as active; with `paused`, it becomes a moon. The
 * button's description gives both in words.
 */
export function AvatarButton({ label, initials, hue = 'rose', src, open = false, presence, paused, type = 'button', ...rest }: AvatarButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      {...(description(presence, paused) === '' ? {} : { 'aria-description': description(presence, paused) })}
      aria-haspopup="menu"
      aria-expanded={open}
      {...tooltip(label)}
      {...rest}
      {...menuTriggerHandlers({ ...rest, 'aria-haspopup': 'menu' })}
      {...stylex.props(interactive.reset, interactive.feedback, interactive.press, focusRing.outside, styles.button, open && styles.open)}
    >
      <span {...stylex.props(styles.avatar)}>
        <Avatar label={initials} size={24} hue={hue} {...(src === undefined ? {} : { src })} />
        {presence === undefined && paused === undefined ? null : <PresenceDot active={presence === 'active'} surface="subtle" paused={paused !== undefined} />}
      </span>
    </button>
  )
}

/** "Away. Notifications paused until 9am": the dot and the moon in words. */
function description(presence: AvatarButtonProps['presence'], paused: string | undefined): string {
  const words = presence === undefined ? [] : [presence === 'active' ? 'Active' : 'Away']
  if (paused !== undefined) words.push(`Notifications ${paused.charAt(0).toLowerCase()}${paused.slice(1)}`)
  return words.join('. ')
}

const styles = stylex.create({
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-30'],
    height: sizes['--control-30'],
    borderRadius: radii['--radius-full'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  avatar: {
    position: 'relative',
    display: 'inline-flex',
  },
  // The hover fill held still, so opening the menu changes no colour.
  open: {
    backgroundColor: colors['--surface-hover'],
  },
})
