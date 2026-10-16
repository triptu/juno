import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes } from 'react'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { Avatar, type HueName } from './Avatar'
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
}

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

/**
 * The title bar's account button: a 24px avatar inside a 30px round ghost
 * button. Press scale, hover fill and the keyboard focus ring come from the
 * shared interactive styles.
 */
export function AvatarButton({ label, initials, hue = 'rose', src, open = false, type = 'button', ...rest }: AvatarButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      {...tooltip(label)}
      {...rest}
      {...stylex.props(interactive.reset, interactive.feedback, interactive.press, interactive.focusRing, styles.button, open && styles.open)}
    >
      <Avatar label={initials} size={24} hue={hue} {...(src === undefined ? {} : { src })} />
    </button>
  )
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
  open: {
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
  },
})
