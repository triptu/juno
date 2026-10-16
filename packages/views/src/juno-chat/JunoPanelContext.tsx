import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { TextAlignLeft } from '@phosphor-icons/react/dist/icons/TextAlignLeft'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ReactNode } from 'react'
import { aboutLabel, chatCopy, type About, type PlaceTint, type Selection } from '@juno/agent-contract'
import { colors, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, type PhosphorIcon } from '@juno/ui'

/** The topic beside the panel, as the topic chip names it. */
export interface PanelPlace {
  readonly tint: PlaceTint
  /** "eng · Main", or "eng · Postgres 16 migration plan". The kind icon stands for the "#". */
  readonly label: string
}

export interface JunoPanelContextProps {
  /** The topic the panel sits beside. Absent while it loads: the row keeps its height, empty. */
  readonly place?: PanelPlace
  /** The owner's selection in the topic, sent with the next message. */
  readonly selection?: Selection
  readonly onRemoveSelection?: () => void
  /** From Ask Juno in a person's or channel's menu: the message is about them instead of the topic. */
  readonly about?: Exclude<About, { _tag: 'topic' }>
  readonly onRemoveAbout?: () => void
}

const tintIcons: Record<PlaceTint, PhosphorIcon> = { public: Hash, private: Lock, dm: User }

const aboutIcon = (about: Exclude<About, { _tag: 'topic' }>): PhosphorIcon => (about._tag === 'person' ? User : tintIcons[about.tint])

/** "Leo: we should use logical replication…", the selection's tooltip. */
const selectionTitle = (selection: Selection) => (selection.sender === undefined ? selection.text : `${selection.sender}: ${selection.text}`)

/**
 * What goes with the panel's next message, as chips in the top of its
 * composer field (inventory 12.1): the topic Juno sees, and "Selection"
 * while text is selected in it, or the person or channel an About asks
 * about instead. The row is always there, so the field never changes
 * height when a selection comes or goes.
 */
export function JunoPanelContext({ place, selection, onRemoveSelection, about, onRemoveAbout }: JunoPanelContextProps) {
  const label = about !== undefined ? `${chatCopy.about.prefix}${aboutLabel(about)}` : place?.label
  const icon = about !== undefined ? aboutIcon(about) : place === undefined ? undefined : tintIcons[place.tint]
  return (
    <div data-panel-context="" {...stylex.props(styles.row)}>
      {label !== undefined && icon !== undefined ? (
        <Chip
          icon={icon}
          label={label}
          title={chatCopy.panel.contextLabel(label)}
          data={about !== undefined ? { 'data-panel-sees': '', 'data-about-chip': about._tag } : { 'data-panel-sees': '' }}
          remove={about !== undefined && onRemoveAbout !== undefined ? <IconButton icon={X} label={chatCopy.about.remove} size={20} radius="full" iconSize={12} tone="muted" onClick={onRemoveAbout} /> : undefined}
        />
      ) : null}
      {about === undefined && selection !== undefined ? (
        <Chip
          icon={TextAlignLeft}
          label={chatCopy.panel.selection}
          title={selectionTitle(selection)}
          data={{ 'data-panel-selection': '' }}
          fixed
          remove={onRemoveSelection !== undefined ? <IconButton icon={X} label={chatCopy.panel.removeSelection} size={20} radius="full" iconSize={12} tone="muted" onClick={onRemoveSelection} /> : undefined}
        />
      ) : null}
    </div>
  )
}

interface ChipProps {
  readonly icon: PhosphorIcon
  readonly label: string
  readonly title: string
  readonly data: Readonly<Record<`data-${string}`, string>>
  /** Keeps its width; the topic chip shrinks first. */
  readonly fixed?: boolean
  readonly remove: ReactNode
}

function Chip({ icon, label, title, data, fixed = false, remove }: ChipProps) {
  return (
    <span {...data} title={title} {...stylex.props(styles.chip, fixed && styles.fixed, remove !== undefined && styles.removable)}>
      <span {...stylex.props(styles.icon)}>
        <Icon icon={icon} size={12} />
      </span>
      <span {...stylex.props(styles.label)}>{label}</span>
      {remove}
    </span>
  )
}

const styles = stylex.create({
  // Inside the field, above the textarea: 8px under the field's top edge and, with the textarea's own
  // 9px less the row's 1px overlap, 8px over its line box. Its start is the field's text: the field's 14px
  // inset and the textarea's 4px.
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    height: sizes['--control-24'],
    marginTop: spacing['--space-2'],
    paddingInlineStart: spacing['--space-1'],
    paddingInlineEnd: spacing['--space-1-5'],
    userSelect: 'none',
  },
  // A pill: 12px corners, concentric with the field's 20px corner 8px out.
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    minWidth: 0,
    height: sizes['--control-24'],
    boxSizing: 'border-box',
    paddingInlineStart: spacing['--space-2'],
    paddingInlineEnd: spacing['--space-2-5'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: text['--text-meta-weight'],
    lineHeight: text['--text-meta-leading'],
    letterSpacing: text['--text-meta-tracking'],
    whiteSpace: 'nowrap',
  },
  fixed: {
    flexShrink: 0,
  },
  // The 20px x sits 2px in from the chip's end, as far as from its top and bottom.
  removable: {
    paddingInlineEnd: spacing['--space-0-5'],
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  label: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
})
