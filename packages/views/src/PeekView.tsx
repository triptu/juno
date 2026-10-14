import * as stylex from '@stylexjs/stylex'
import { useId, type ReactNode } from 'react'
import { colors, layout, spacing, z } from '@juno/tokens/tokens.stylex'
import { Surface, Text } from '@juno/ui'

export interface PeekViewProps {
  /** The topic's title, or the channel's label for a Main. */
  readonly title: string
  /** Where the topic lives ("#eng", "Maya Chen"). Omitted for a Main, whose title already says it. */
  readonly where?: string
  /** The topic's art, 20px. */
  readonly art?: ReactNode
  /** The topic's messages: a `MessageList` with no actions. */
  readonly children: ReactNode
}

/**
 * The peek popover (spec section 5): a read-only look at a topic, beside the
 * sidebar, while the peek key is held over its row. Place it in the shell's
 * `peek` slot; it hangs off the sidebar's right edge, from under the title
 * bar to near the window's bottom, and floats over the workspace, so it
 * moves nothing when it appears.
 *
 * A non-modal dialog: it never takes focus, so the row or the composer that
 * had it keeps it, and it is named by the topic's title. It appears at once
 * and closes at once; a peek lasts as long as a key is held.
 */
export function PeekView({ title, where, art, children }: PeekViewProps) {
  const titleId = useId()
  return (
    <div role="dialog" aria-modal={false} aria-labelledby={titleId} aria-roledescription="peek" data-peek="" {...stylex.props(styles.place)}>
      <Surface kind="popover" padding="none" sx={styles.panel}>
        <div {...stylex.props(styles.header)}>
          {art === undefined ? null : <span {...stylex.props(styles.art)}>{art}</span>}
          <Text variant="rowTitle" weight="semibold" truncate dir="auto" id={titleId} sx={styles.title}>
            {title}
          </Text>
          {where === undefined ? null : (
            <Text variant="meta" tone="muted" truncate dir="auto" sx={styles.where}>
              {where}
            </Text>
          )}
        </div>
        <div {...stylex.props(styles.list)}>{children}</div>
      </Surface>
    </div>
  )
}

const styles = stylex.create({
  // Beside the sidebar's slot (its containing block), over the workspace.
  // The width gives way when the shell (the query container) has less room
  // right of the sidebar than the token.
  place: {
    position: 'absolute',
    top: layout['--titlebar-height'],
    bottom: spacing['--space-2'],
    left: `calc(100% + ${spacing['--space-2']})`,
    zIndex: z['--z-menu'],
    display: 'flex',
    width: layout['--peek-width'],
    maxWidth: `calc(100cqw - 100% - 2 * ${spacing['--space-2']})`,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    overscrollBehavior: 'contain',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexShrink: 0,
    minWidth: 0,
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-4'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  art: {
    display: 'flex',
    flexShrink: 0,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
  },
  where: {
    flexShrink: 2,
    minWidth: 0,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
  },
})
