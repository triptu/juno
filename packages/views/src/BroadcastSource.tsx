import * as stylex from '@stylexjs/stylex'
import type { MessageView } from '@juno/contract'
import { colors, radii, sizes } from '@juno/tokens/tokens.stylex'
import { activateHandlers, focusRing, Text, type ActivateEvent } from '@juno/ui'

export interface BroadcastSourceProps {
  readonly from: NonNullable<MessageView['broadcastFrom']>
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onOpen: (event: ActivateEvent) => void
  readonly tabIndex: 0 | -1
}

const HOVER = '@media (hover: hover)'

/**
 * In Main, after a broadcast reply's time: "replied to a thread: Deploy
 * plan for…" (SPEC 7, "Messages"). It opens the thread at the reply on mouse
 * down, as a thread link does; ⌘ opens it behind. Muted and underlined on
 * hover, as a shared message's place is. Cut to the header's width.
 */
export function BroadcastSource({ from, onOpen, tabIndex }: BroadcastSourceProps) {
  return (
    <span
      role="link"
      tabIndex={tabIndex}
      aria-label={from.preview === undefined ? 'Replied to a thread' : `Replied to a thread: ${from.preview}`}
      data-broadcast-source={from.id}
      {...activateHandlers<HTMLSpanElement>(onOpen)}
      {...stylex.props(styles.link, focusRing.outside)}
    >
      <Text variant="meta" tone="inherit" truncate tooltipWhenTruncated dir="auto" as="span">
        {'replied to a thread'}
        {from.preview === undefined ? null : (
          <>
            {': '}
            <span data-sensitive="">{from.preview}</span>
          </>
        )}
      </Text>
    </span>
  )
}

const styles = stylex.create({
  link: {
    display: 'inline-flex',
    flexShrink: 1,
    minWidth: 0,
    color: colors['--foreground-muted'],
    borderRadius: radii['--radius-xs'],
    cursor: 'default',
    textDecorationLine: { default: 'none', ':hover': { default: null, [HOVER]: 'underline' } },
    textDecorationColor: colors['--link-underline'],
    textUnderlineOffset: sizes['--link-underline-offset'],
  },
})
