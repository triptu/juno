import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { ActivateEvent } from '@juno/ui'
import { accent, colors, motion, sizes, spacing, radii } from '@juno/tokens/tokens.stylex'

export interface InlineLinkProps {
  readonly onOpen: (event: ActivateEvent) => void
  /** The tooltip. */
  readonly title?: string
  readonly 'data-cite'?: string
  readonly 'data-source'?: string
  readonly children: ReactNode
}

const HOVER = '@media (hover: hover)'

const modifiers = (event: MouseEvent | KeyboardEvent) => ({ metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey })

/**
 * Words in a Juno bubble that open something: a recall citation or a Slack
 * source. A span and not a button, because a button is one box that cannot
 * wrap, so a long source would leave its line. It wraps with the words
 * around it, stays selectable with them, and opens on click, like a link in
 * a Slack message.
 */
export function InlineLink({ onOpen, title, children, ...data }: InlineLinkProps) {
  return (
    <span
      role="link"
      tabIndex={0}
      title={title}
      {...data}
      onClick={(event) => onOpen({ ...modifiers(event), source: 'pointer' })}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        onOpen({ ...modifiers(event), source: 'keyboard' })
      }}
      {...stylex.props(styles.link)}
    >
      {children}
    </span>
  )
}

const styles = stylex.create({
  link: {
    color: colors['--foreground-subtle'],
    textDecorationLine: 'underline',
    textDecorationColor: {
      default: colors['--foreground-muted'],
      ':hover': { default: null, [HOVER]: colors['--foreground-default'] },
    },
    textUnderlineOffset: spacing['--space-0-5'],
    cursor: 'default',
    borderRadius: radii['--radius-inline'],
    transitionProperty: 'text-decoration-color',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
  },
})
