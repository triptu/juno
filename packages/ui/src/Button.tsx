import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { colors, fonts, motion, radii, spacing, type } from '@juno/tokens/tokens.stylex'

export type ButtonVariant = 'secondary' | 'primary'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className'> {
  readonly variant?: ButtonVariant
  readonly children: ReactNode
}

/**
 * A plain button. Arrow cursor (never pointer), scales to 0.96 while pressed
 * unless disabled, hover colour only on hover-capable pointers, and a 2px
 * focus ring in the selection blue for keyboard focus only.
 */
export function Button({ variant = 'secondary', type: buttonType = 'button', ...rest }: ButtonProps) {
  return <button type={buttonType} {...rest} {...stylex.props(styles.base, variants[variant])} />
}

const styles = stylex.create({
  base: {
    appearance: 'none',
    cursor: 'default',
    userSelect: 'none',
    // Disabled buttons get no pointer events, so :active can never fire on
    // them and the press scale never applies.
    pointerEvents: {
      default: 'auto',
      ':disabled': 'none',
    },
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    margin: 0,
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3'],
    borderWidth: 0,
    borderRadius: radii['--radius-md'],
    fontFamily: fonts['--font-sans'],
    fontSize: type['--text-sm'],
    fontWeight: 500,
    lineHeight: type['--leading-snug'],
    letterSpacing: type['--tracking-normal'],
    transitionProperty: 'background-color, transform',
    transitionDuration: {
      default: motion['--duration-fast'],
      '@media (prefers-reduced-motion: reduce)': '0ms',
    },
    transitionTimingFunction: motion['--ease-standard'],
    transform: {
      default: 'none',
      ':active': 'scale(0.96)',
      ':disabled': 'none',
    },
    opacity: {
      default: 1,
      ':disabled': 0.5,
    },
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: 2,
    outlineOffset: 2,
    outlineColor: colors['--selection-background'],
  },
})

const variants = stylex.create({
  secondary: {
    color: colors['--foreground-default'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': {
        default: null,
        '@media (hover: hover)': colors['--secondary-hover'],
      },
      ':active': colors['--secondary-active'],
      ':disabled': colors['--secondary-default'],
    },
  },
  primary: {
    color: colors['--accent-foreground'],
    backgroundColor: {
      default: colors['--accent-default'],
      ':hover': {
        default: null,
        '@media (hover: hover)': colors['--accent-hover'],
      },
      ':active': colors['--accent-active'],
      ':disabled': colors['--accent-default'],
    },
  },
})
