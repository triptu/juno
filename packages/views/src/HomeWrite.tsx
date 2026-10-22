import * as stylex from '@stylexjs/stylex'
import type { PickConversation } from '@juno/contract'
import { colors, layout, spacing, z } from '@juno/tokens/tokens.stylex'
import { Kbd, OptionGroupLabel, OptionList, OptionRow, Surface, Text } from '@juno/ui'
import { DestinationMark } from './DestinationMark'
import { destinationLabel, sendToRowId } from './homeDestination'

/**
 * Home's writing block (SPEC section 12, "Writing"): the destination chip,
 * then the field, at the bottom of Home on the composer's left edge. The
 * container puts `HomeWriteTop` in the composer's `above` slot and
 * `SendToList` in its suggestions slot.
 */

export interface SendToListProps {
  /** People for a first @, channels for a first #. */
  readonly kind: 'person' | 'channel'
  readonly rows: ReadonlyArray<PickConversation>
  /** The list's element id; a row's id is `${id}-${key}`. */
  readonly id: string
  readonly activeKey: string | undefined
  readonly onActivate: (key: string) => void
  readonly onPick: (key: string) => void
}

/**
 * The rows a first @ or # opens while Juno is chosen. It suggests and never
 * takes over: the text stays in the field, Tab or Enter on a row makes it
 * the destination, Space or Esc closes the list and keeps the text for
 * Juno. The footer says so. Above the field, as the @ suggestions are.
 */
export function SendToList({ kind, rows, id, activeKey, onActivate, onPick }: SendToListProps) {
  const active = rows.find((row) => row.key === activeKey)
  return (
    <div data-send-to="" {...stylex.props(styles.sendTo)}>
      <Surface kind="popover">
        <OptionList id={id} label="Send to" {...(active === undefined ? {} : { activeId: sendToRowId(id, active.key) })}>
          <OptionGroupLabel>{kind === 'person' ? 'Send to a person' : 'Send to a channel'}</OptionGroupLabel>
          {rows.map((row) => (
            <OptionRow
              key={row.key}
              id={sendToRowId(id, row.key)}
              size={32}
              active={row.key === activeKey}
              leading={<DestinationMark conversation={row} />}
              label={row.name}
              sub={row.kind === 'im' ? (row.empty ? 'No messages yet' : 'Direct message') : row.kind === 'mpim' ? 'Group DM' : row.kind === 'private' ? 'Private channel' : 'Public channel'}
              onSelect={() => onPick(row.key)}
              onActivate={() => onActivate(row.key)}
            />
          ))}
        </OptionList>
        <div {...stylex.props(styles.foot)}>
          <span {...stylex.props(styles.hint)}>
            <Kbd look="key">Tab</Kbd>
            <Text variant="meta" tone="muted" as="span" truncate>
              Send to {active === undefined ? 'it' : destinationLabel(active)}
            </Text>
          </span>
          <span {...stylex.props(styles.hint)}>
            <Kbd look="key">Space</Kbd>
            <Text variant="meta" tone="muted" as="span">
              Keep as text
            </Text>
          </span>
        </div>
      </Surface>
    </div>
  )
}

const styles = stylex.create({
  // Above the field box with the usual 6px gap, on its left edge, as the @ suggestions are.
  sendTo: {
    position: 'absolute',
    zIndex: z['--z-mention'],
    width: layout['--send-to-width'],
    bottom: 'anchor(--composer-box top)',
    left: 'anchor(--composer-box left)',
    marginBottom: spacing['--space-1-5'],
    // In a short window the list can rise over a title bar's drag strip.
    WebkitAppRegion: 'no-drag',
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-4'],
    marginTop: spacing['--space-1'],
    paddingTop: spacing['--space-2'],
    paddingInline: spacing['--space-2'],
    paddingBottom: spacing['--space-1'],
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--border-default'],
  },
  hint: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
})
