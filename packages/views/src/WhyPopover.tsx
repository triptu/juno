import * as stylex from '@stylexjs/stylex'
import { spacing, z } from '@juno/tokens/tokens.stylex'
import { Button, Popover, Text } from '@juno/ui'

export interface WhyPopoverProps {
  /** Where the message menu opened, in window pixels. The popover hangs below it. */
  readonly at: { readonly x: number; readonly y: number }
  /** "Notified you at 13:42", "Didn't notify you", "In the 9am summary". */
  readonly title: string
  /** The decision's reason, in words. */
  readonly reason: string
  /** Change when a setting decided it, Tell Juno when Juno did. None when nothing can change it. */
  readonly action?: { readonly label: 'Change' | 'Tell Juno'; readonly onAction: () => void }
  readonly onClose: () => void
}

/**
 * Why a message did or did not notify (inventory 15.4): a title, the
 * reason, and one button. Esc or a click outside closes it.
 */
export function WhyPopover({ at, title, reason, action, onClose }: WhyPopoverProps) {
  return (
    <div {...stylex.props(styles.anchor(at.x, at.y))}>
      <Popover open onClose={onClose} anchor={<span />} placement="bottom-start" width="browse" layer="context" padding="md" label={title}>
        <div {...stylex.props(styles.body)}>
          <Text variant="ui" weight="semibold" as="h3">
            {title}
          </Text>
          <Text variant="ui" tone="subtle" as="p">
            {reason}
          </Text>
          {action === undefined ? null : (
            <div {...stylex.props(styles.actions)}>
              <Button variant="secondary" size="sm" onClick={action.onAction}>
                {action.label}
              </Button>
            </div>
          )}
        </div>
      </Popover>
    </div>
  )
}

const styles = stylex.create({
  anchor: (x: number, y: number) => ({
    position: 'fixed',
    left: x,
    top: y,
    zIndex: z['--z-context'],
  }),
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
})
