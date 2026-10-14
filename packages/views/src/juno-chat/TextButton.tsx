import * as stylex from '@stylexjs/stylex'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { accent, colors, motion, sizes } from '@juno/tokens/tokens.stylex'

export type TextButtonTone = 'default' | 'subtle' | 'muted' | 'danger'

export interface TextButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className'> {
  /** `default` reads as a link in `--foreground-default`; `muted` follows the line it sits in. */
  readonly tone?: TextButtonTone
  readonly children: ReactNode
}

const HOVER = '@media (hover: hover)'

/**
 * A word that acts, inside a line of meta text: "Undo", "Open", "Try again",
 * "Ask again", "Resume", "Review". It sits on the text baseline at the
 * line's size, underlined, and takes no space beyond its word, so a line
 * reads the same whether or not it has one.
 */
export function TextButton({ tone = 'default', type = 'button', children, ...rest }: TextButtonProps) {
  return (
    <button type={type} {...rest} {...stylex.props(styles.base, tones[tone])}>
      {children}
    </button>
  )
}

const styles = stylex.create({
  base: {
    appearance: 'none',
    display: 'inline',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    letterSpacing: 'inherit',
    textDecorationLine: 'underline',
    textDecorationColor: colors['--border-strongest'],
    textUnderlineOffset: '2px',
    userSelect: 'none',
    cursor: 'default',
    borderRadius: '2px',
    transitionProperty: 'color, text-decoration-color',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
})

const tones = stylex.create({
  default: {
    color: colors['--foreground-default'],
    textDecorationColor: {
      default: colors['--border-strongest'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
  },
  // A citation inside a Juno bubble: subtle text, underlined in the muted grey.
  subtle: {
    color: colors['--foreground-subtle'],
    textDecorationColor: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
  },
  muted: {
    color: {
      default: 'inherit',
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
  },
  danger: {
    color: colors['--danger'],
    textDecorationColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--danger'] },
    },
  },
})
