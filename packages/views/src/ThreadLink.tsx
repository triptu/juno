import * as stylex from '@stylexjs/stylex'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import type { Person, ThreadLink as ThreadLinkModel } from '@juno/contract'
import { colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { activateHandlers, AvatarStack, focusRing, Icon, Text, type ActivateEvent } from '@juno/ui'
import { stackPerson } from './look'

export interface ThreadLinkProps {
  readonly link: ThreadLinkModel
  readonly people?: ReadonlyMap<string, Person>
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onOpen: (id: string, event: ActivateEvent) => void
  readonly tabIndex?: 0 | -1
}

const HOVER = '@media (hover: hover)'

/**
 * "2 replies · Maya: Sounds good… ›" under a Main message that has a thread (inventory
 * 6.7). Navigates on mouse down like a row.
 */
export function ThreadLink({ link, people, onOpen, tabIndex = 0 }: ThreadLinkProps) {
  const repliers = (link.replierIds ?? []).slice(0, 3).flatMap((id) => {
    const person = people?.get(id)
    return person === undefined ? [] : [stackPerson(person)]
  })
  return (
    <div
      role="button"
      tabIndex={tabIndex}
      aria-label={link.preview === undefined ? link.label : `${link.label}: ${link.preview}`}
      data-thread-link={link.id}
      {...activateHandlers<HTMLDivElement>((event) => onOpen(link.id, event))}
      {...stylex.props(styles.link, focusRing.outside)}
    >
      {repliers.length > 0 ? <AvatarStack people={repliers} max={3} size={16} surface="surface" /> : <Icon icon={ChatsCircle} size={16} />}
      <span {...stylex.props(styles.count)}>{link.label}</span>
      {link.preview === undefined ? null : (
        <Text data-sensitive variant="meta" tone="inherit" truncate tooltipWhenTruncated dir="auto" as="span" sx={styles.preview}>
          {link.preview}
        </Text>
      )}
      <span {...stylex.props(styles.caret)}>
        <Icon icon={CaretRight} size={12} />
      </span>
    </div>
  )
}

const styles = stylex.create({
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    maxWidth: '100%',
    height: sizes['--control-26'],
    marginTop: spacing['--space-1-5'],
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-2'],
    borderRadius: radii['--radius-lg'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors['--border-default'],
      ':hover': { default: null, [HOVER]: colors['--border-strongest'] },
    },
    backgroundColor: colors['--surface-default'],
    color: colors['--foreground-subtle'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    lineHeight: 1,
    userSelect: 'none',
    cursor: 'default',
  },
  count: {
    flexShrink: 0,
    fontWeight: weights['--weight-semibold'],
    color: colors['--foreground-default'],
  },
  preview: {
    lineHeight: 1,
  },
  caret: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
})
