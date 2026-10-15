import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { aboutLabel, chatCopy, type About, type Selection } from '@juno/agent-contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Chip, IconButton, Text, type PhosphorIcon } from '@juno/ui'

export interface JunoPanelContextProps {
  /** The owner's selection in the topic, sent as a quote with the next message. */
  readonly selection?: Selection
  readonly onRemoveSelection?: () => void
  /** From Ask Juno in a person's or channel's menu: the message is about them instead of the topic. */
  readonly about?: Exclude<About, { _tag: 'topic' }>
  readonly onRemoveAbout?: () => void
  /** The topic opened at a "new" divider: one pill that sends "Catch me up". */
  readonly onCatchMeUp?: () => void
}

const aboutIcon = (about: Exclude<About, { _tag: 'topic' }>): PhosphorIcon =>
  about._tag === 'person' || about.tint === 'dm' ? User : about.tint === 'private' ? Lock : Hash

/**
 * What goes with the panel's next message, above its composer (inventory
 * 12.1), stacked: the selection quote, the About chip, the Catch me up
 * pill. Nothing renders when there is nothing to show, so the composer
 * stays where it was. While an About chip shows there is no Catch me up.
 */
export function JunoPanelContext({ selection, onRemoveSelection, about, onRemoveAbout, onCatchMeUp }: JunoPanelContextProps) {
  const catchUp = about === undefined ? onCatchMeUp : undefined
  if (selection === undefined && about === undefined && catchUp === undefined) return null
  return (
    <div data-panel-context="" {...stylex.props(styles.stack)}>
      {selection !== undefined ? (
        <div data-panel-selection="" {...stylex.props(styles.selection)}>
          <span aria-hidden {...stylex.props(styles.bar)} />
          <span {...stylex.props(styles.quote)}>
            {selection.sender !== undefined ? (
              <Text variant="tagSmall" weight="semibold" tone="default" truncate dir="auto">
                {selection.sender}
              </Text>
            ) : null}
            <Text variant="meta" tone="subtle" clamp={3} dir="auto">
              {selection.text}
            </Text>
          </span>
          {onRemoveSelection !== undefined ? <IconButton icon={X} label={chatCopy.panel.removeQuote} size={20} radius="sm" iconSize={12} tone="muted" onClick={onRemoveSelection} /> : null}
        </div>
      ) : null}
      {about !== undefined ? (
        <span {...stylex.props(styles.row)}>
          <Chip variant="filled" size={26} icon={aboutIcon(about)} data-about-chip={about._tag} {...(onRemoveAbout ? { onRemove: onRemoveAbout, removeLabel: chatCopy.about.remove } : {})} shrink>
            {`${chatCopy.about.prefix}${aboutLabel(about)}`}
          </Chip>
        </span>
      ) : null}
      {catchUp !== undefined ? (
        <span {...stylex.props(styles.row)}>
          <Chip interactive variant="filled" size={28} data-catch-me-up="" onClick={catchUp}>
            {chatCopy.panel.catchMeUp}
          </Chip>
        </span>
      ) : null}
    </div>
  )
}

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    paddingBottom: spacing['--space-1-5'],
    minWidth: 0,
  },
  row: {
    display: 'flex',
    minWidth: 0,
  },
  selection: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
    minWidth: 0,
    userSelect: 'none',
  },
  bar: {
    flexShrink: 0,
    alignSelf: 'stretch',
    width: '2px',
    backgroundColor: colors['--border-strong'],
  },
  quote: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
  },
})
