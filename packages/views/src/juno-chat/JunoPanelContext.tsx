import * as stylex from '@stylexjs/stylex'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { aboutLabel, chatCopy, type About, type PlaceTint, type Selection } from '@juno/agent-contract'
import { colors, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, type PhosphorIcon } from '@juno/ui'
import { SuggestionChip } from './SuggestionChip'

/** The topic beside the panel, as the context line names it. */
export interface PanelPlace {
  readonly tint: PlaceTint
  /** "eng · Main", or "eng · Postgres 16 migration plan". The kind icon stands for the "#". */
  readonly label: string
}

export interface JunoPanelContextProps {
  /** The topic the panel sits beside. Absent while it loads: the line keeps its height, empty. */
  readonly place?: PanelPlace
  /** The owner's selection in the topic, sent with the next message. */
  readonly selection?: Selection
  readonly onRemoveSelection?: () => void
  /** From Ask Juno in a person's or channel's menu: the message is about them instead of the topic. */
  readonly about?: Exclude<About, { _tag: 'topic' }>
  readonly onRemoveAbout?: () => void
  /** The topic opened at a "new" divider: a suggestion chip that sends "Catch me up". */
  readonly onCatchMeUp?: () => void
}

const tintIcons: Record<PlaceTint, PhosphorIcon> = { public: Hash, private: Lock, dm: User }

const aboutIcon = (about: Exclude<About, { _tag: 'topic' }>): PhosphorIcon => (about._tag === 'person' ? User : tintIcons[about.tint])

/** "Leo: we should use logical replication…", the selection's tooltip. */
const selectionTitle = (selection: Selection) => (selection.sender === undefined ? selection.text : `${selection.sender}: ${selection.text}`)

/**
 * What goes with the panel's next message, above its composer (inventory
 * 12.1): Catch me up as a suggestion chip when the topic opened at a "new"
 * divider, then one quiet line that says what Juno sees: the topic, and
 * "+ selection" while text is selected in it, or the person or channel an
 * About asks about instead. The line is always there, so the composer
 * never moves when a selection comes or goes.
 */
export function JunoPanelContext({ place, selection, onRemoveSelection, about, onRemoveAbout, onCatchMeUp }: JunoPanelContextProps) {
  const catchUp = about === undefined ? onCatchMeUp : undefined
  const label = about !== undefined ? `${chatCopy.about.prefix}${aboutLabel(about)}` : place?.label
  const icon = about !== undefined ? aboutIcon(about) : place === undefined ? undefined : tintIcons[place.tint]
  return (
    <div data-panel-context="" {...stylex.props(styles.stack)}>
      {catchUp !== undefined ? (
        <div {...stylex.props(styles.chips)}>
          <SuggestionChip icon={ClockCounterClockwise} label={chatCopy.panel.catchMeUp} onSend={catchUp} data={{ 'data-catch-me-up': '' }} />
        </div>
      ) : null}
      <div data-panel-sees="" title={label === undefined ? undefined : chatCopy.panel.contextLabel(label)} {...stylex.props(styles.line)}>
        {icon !== undefined ? (
          <span {...stylex.props(styles.icon)}>
            <Icon icon={icon} size={12} />
          </span>
        ) : null}
        {about !== undefined ? (
          <span data-about-chip={about._tag} {...stylex.props(styles.label)}>
            {label}
          </span>
        ) : (
          <span {...stylex.props(styles.label)}>{label}</span>
        )}
        {about !== undefined && onRemoveAbout !== undefined ? <IconButton icon={X} label={chatCopy.about.remove} size={20} radius="sm" iconSize={12} tone="muted" onClick={onRemoveAbout} /> : null}
        {about === undefined && selection !== undefined ? (
          <span data-panel-selection="" title={selectionTitle(selection)} {...stylex.props(styles.selection)}>
            {chatCopy.panel.selection}
            {onRemoveSelection !== undefined ? <IconButton icon={X} label={chatCopy.panel.removeSelection} size={20} radius="sm" iconSize={12} tone="muted" onClick={onRemoveSelection} /> : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    paddingBottom: spacing['--space-1'],
    minWidth: 0,
  },
  // Chips sit on the field's edge.
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  // One 20px line, lined up with the field's text.
  line: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    height: sizes['--control-20'],
    minWidth: 0,
    paddingInline: spacing['--space-3-5'],
    color: colors['--foreground-muted'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: text['--text-meta-weight'],
    lineHeight: text['--text-meta-leading'],
    letterSpacing: text['--text-meta-tracking'],
    userSelect: 'none',
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  label: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  selection: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing['--space-0-5'],
    color: colors['--foreground-subtle'],
    whiteSpace: 'nowrap',
  },
})
