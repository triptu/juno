import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, layout, radii, sizes, spacing, weights, z } from '@juno/tokens/tokens.stylex'
import { Kbd } from './Kbd'
import { interactive } from './internal/interactive'
import { variants as typeVariants } from './internal/type'
import { Surface } from './Surface'

const HOVER = '@media (hover: hover)'

export interface ToastAction {
  readonly label: string
  readonly kbd?: string
  readonly onAction: () => void
}

export interface ToastProps {
  readonly text: string
  readonly action?: ToastAction
}

/** One line of dark text on a floating ink surface, with an optional Undo. */
export function Toast({ text, action }: ToastProps) {
  return (
    <Surface kind="toast" role="status" aria-live="polite" sx={styles.toast}>
      <span {...stylex.props(typeVariants.ui, styles.text)}>{text}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onAction}
          {...stylex.props(interactive.reset, interactive.feedback, interactive.press, interactive.focusRing, typeVariants.buttonSmall, styles.action)}
        >
          {action.label}
          {action.kbd ? <Kbd inherit>{action.kbd}</Kbd> : null}
        </button>
      ) : null}
    </Surface>
  )
}

export interface ToastRegionProps {
  readonly children?: ReactNode
}

/** Pins its child to the bottom-left corner of the window. */
export function ToastRegion({ children }: ToastRegionProps) {
  return <div {...stylex.props(styles.region)}>{children}</div>
}

const styles = stylex.create({
  region: {
    position: 'absolute',
    insetInlineStart: layout['--toast-inset'],
    bottom: layout['--toast-inset'],
    zIndex: z['--z-toast'],
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    maxWidth: layout['--toast-max-width'],
    paddingBlock: spacing['--space-2'],
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-2'],
    pointerEvents: 'auto',
    userSelect: 'none',
  },
  text: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  action: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    flexShrink: 0,
    height: sizes['--control-26'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-md'],
    fontWeight: weights['--weight-semibold'],
    color: 'inherit',
    backgroundColor: {
      default: `color-mix(in oklch, ${colors['--background']} 16%, transparent)`,
      ':hover': { default: null, [HOVER]: `color-mix(in oklch, ${colors['--background']} 24%, transparent)` },
    },
    outlineColor: colors['--background'],
  },
})
