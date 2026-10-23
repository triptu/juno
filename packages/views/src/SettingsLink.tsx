import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { accent, colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { focusRing } from '@juno/ui'

const HOVER = '@media (hover: hover)'

/** Words in a line that open another place in Settings: "Ignored channels", "Notification settings". */
export function SettingsLink({ onClick, children }: { readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} {...stylex.props(styles.link, focusRing.outside)}>
      {children}
    </button>
  )
}

const styles = stylex.create({
  link: {
    appearance: 'none',
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    font: 'inherit',
    color: accent['--hl-text'],
    borderRadius: radii['--radius-xs'],
    cursor: 'default',
    textDecorationLine: { default: 'none', ':hover': { default: null, [HOVER]: 'underline' } },
    textDecorationColor: colors['--link-underline'],
    textUnderlineOffset: sizes['--link-underline-offset'],
  },
})
