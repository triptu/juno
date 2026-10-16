import * as stylex from '@stylexjs/stylex'
import { colors, layout, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Text, type HueName } from '@juno/ui'
import { initials } from './look'

export interface Reactor {
  readonly id: string
  readonly name: string
  /** The signed-in user: shown as "You". */
  readonly you: boolean
  readonly hue: HueName
  readonly avatarUrl?: string
}

export interface ReactorsCardProps {
  /** Slack's name, shown as `:name:`. */
  readonly name: string
  /** The glyph for a standard emoji, or `:name:` when there is no image. */
  readonly emoji: string
  /** A custom emoji's image. */
  readonly url?: string
  /** Who reacted, as far as Slack listed them: you first, at most ten. */
  readonly reactors: ReadonlyArray<Reactor>
  /** The rest of the count: "and N others". */
  readonly others: number
  readonly id?: string
  readonly onPointerEnter?: () => void
  readonly onPointerLeave?: () => void
}

/** "and 1 other", "and 5 others"; without names, "3 people". */
function othersLine(others: number, named: number): string {
  if (named === 0) return others === 1 ? '1 person' : `${others} people`
  return others === 1 ? 'and 1 other' : `and ${others} others`
}

/**
 * Who reacted with one emoji (SPEC 7, inventory 6.4): the emoji large and
 * its name, then a row per person with their avatar, you first, then "and
 * N others" for the rest of the count. The look of the tooltip: the raised
 * surface and the pop shadow. Placing it is the caller's.
 */
export function ReactorsCard({ name, emoji, url, reactors, others, id, onPointerEnter, onPointerLeave }: ReactorsCardProps) {
  return (
    <div id={id} role="tooltip" data-reactors={name} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.head)}>
        {url === undefined ? (
          <span aria-hidden {...stylex.props(styles.glyph)}>
            {emoji}
          </span>
        ) : (
          <img src={url} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
        )}
        <Text variant="meta" tone="muted" truncate>
          :{name}:
        </Text>
      </div>
      {reactors.length === 0 ? null : (
        <ul {...stylex.props(styles.list)}>
          {reactors.map((reactor) => (
            <li key={reactor.id} {...stylex.props(styles.person)}>
              <Avatar label={initials(reactor.name)} name={reactor.name} size={20} hue={reactor.hue} {...(reactor.avatarUrl === undefined ? {} : { src: reactor.avatarUrl })} />
              <Text variant="ui" tone="default" truncate>
                {reactor.you ? 'You' : reactor.name}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {others > 0 ? (
        <Text variant="meta" tone="muted" as="p">
          {othersLine(others, reactors.length)}
        </Text>
      ) : null}
    </div>
  )
}

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    boxSizing: 'border-box',
    minWidth: layout['--reactors-min-width'],
    maxWidth: layout['--menu-width'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--surface-raised'],
    color: colors['--foreground-default'],
    boxShadow: shadows['--pop-shadow'],
    userSelect: 'none',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  // The emoji large, as Slack's own card draws it.
  glyph: {
    fontSize: sizes['--control-28'],
    lineHeight: 1,
  },
  image: {
    width: sizes['--control-28'],
    height: sizes['--control-28'],
    objectFit: 'contain',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  person: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
})
