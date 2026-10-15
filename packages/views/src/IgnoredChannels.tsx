import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { IGNORED_HIDDEN_CAP, type IgnoredChannel } from '@juno/contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, Text } from '@juno/ui'

export interface IgnoredChannelsProps {
  /** Undefined until the list arrives: the card keeps one row's height and shows nothing. */
  readonly channels: ReadonlyArray<IgnoredChannel> | undefined
  readonly onStopIgnoring: (channel: IgnoredChannel) => void
}

function hiddenLabel(hidden: number): string {
  if (hidden === 0) return 'Nothing hidden yet'
  if (hidden >= IGNORED_HIDDEN_CAP) return `${IGNORED_HIDDEN_CAP.toLocaleString('en')}+ messages hidden`
  return hidden === 1 ? '1 message hidden' : `${hidden} messages hidden`
}

/**
 * The ignore list's rows (SPEC 14, inventory 14), inside Preferences' group
 * card. Rows sit on the same 12px inset and 14px rhythm as Appearance's, so
 * the card's edges and the button's right edge line up with the controls
 * above.
 */
export function IgnoredChannels({ channels, onStopIgnoring }: IgnoredChannelsProps) {
  if (channels === undefined) return <div {...stylex.props(styles.list)} aria-busy="true"><div {...stylex.props(styles.row)} /></div>
  if (channels.length === 0) {
    return (
      <div {...stylex.props(styles.list)}>
        <div {...stylex.props(styles.row)}>
          <Text variant="ui" tone="muted">
            Nothing ignored.
          </Text>
        </div>
      </div>
    )
  }
  return (
    <ul {...stylex.props(styles.list)} aria-label="Ignored channels">
      {channels.map((channel) => (
        <li key={channel.id} {...stylex.props(styles.row)} data-ignored-channel={channel.id}>
          <span {...stylex.props(styles.icon)}>
            <Icon icon={channel.kind === 'private' ? Lock : Hash} size={15} />
          </span>
          <span {...stylex.props(styles.name)}>
            <Text variant="ui" tone="default" weight="medium" truncate>
              {channel.name}
            </Text>
            <Text variant="meta" tone="muted">
              {hiddenLabel(channel.hidden)}
            </Text>
          </span>
          <Button variant="secondary" size="sm" onClick={() => onStopIgnoring(channel)} aria-label={`Stop ignoring ${channel.name}`}>
            Stop ignoring
          </Button>
        </li>
      ))}
    </ul>
  )
}

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3-5'],
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  // The same row as Appearance's: one control height, the label column starting at the card's inset.
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    minHeight: spacing['--space-8'],
    minWidth: 0,
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  name: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-2-5'],
    flexGrow: 1,
    minWidth: 0,
  },
})
