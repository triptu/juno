import * as stylex from '@stylexjs/stylex'
import type { PointerEvent } from 'react'
import { colors, layout, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Text, type HueName } from '@juno/ui'
import { TextButton } from './juno-chat/TextButton'

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
  /** Who reacted, as far as Juno knows them: you first. */
  readonly reactors: ReadonlyArray<Reactor>
  /** Everyone who reacted with it, named or not. */
  readonly count: number
  /** The chip points at the card with `aria-describedby` while it shows. */
  readonly id?: string
  /** Opens the reactions dialog on this emoji. Without it, the card names as many as it can and stops there. */
  readonly onSeeAll?: () => void
  readonly onPointerEnter?: () => void
  readonly onPointerLeave?: () => void
}

/** At most this many names, and no more than about two lines of them, before "and N others". */
const MOST_NAMES = 6
const MOST_CHARACTERS = 64

/**
 * The people a card names, and how many it leaves to "and N others": you
 * first, then names until about two lines of the card are full. The last
 * person is named rather than counted as "1 other" when Juno knows them.
 */
export function reactorsLine(reactors: ReadonlyArray<Reactor>, count: number): { readonly names: ReadonlyArray<string>; readonly others: number } {
  const names: Array<string> = []
  let length = 0
  for (const [index, reactor] of reactors.entries()) {
    const name = reactor.you ? 'You' : reactor.name
    const lastOne = index === reactors.length - 1 && reactors.length === count
    if (names.length > 0 && !lastOne && (names.length === MOST_NAMES || length + name.length > MOST_CHARACTERS)) break
    names.push(name)
    length += name.length + 2
  }
  return { names, others: Math.max(0, count - names.length) }
}

/** "You, Maya Chen and 3 others"; "Maya Chen and Leo Park"; "3 people" when nobody is known. */
export function reactorsSentence({ names, others }: ReturnType<typeof reactorsLine>): string {
  if (names.length === 0) return others === 1 ? '1 person' : `${others} people`
  if (others > 0) return `${names.join(', ')} and ${others === 1 ? '1 other' : `${others} others`}`
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
}

/**
 * Who reacted with one emoji (SPEC 7, inventory 6.4), in the shape of
 * Slack's card: the emoji large, the people as one sentence, then
 * "reacted with :name:". When it cannot name everyone, See all at the end
 * of that line opens the reactions dialog. The look of the tooltip: the
 * raised surface and the pop shadow. Placing it is the caller's.
 */
export function ReactorsCard({ name, emoji, url, reactors, count, id, onSeeAll, onPointerEnter, onPointerLeave }: ReactorsCardProps) {
  const line = reactorsLine(reactors, count)
  const cut = line.others > 0
  // Opens on mouse down, as a popover's trigger does; the dialog takes over from the card.
  const seeAll = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.ctrlKey || onSeeAll === undefined) return
    event.preventDefault()
    onSeeAll()
  }
  return (
    <div id={id} role="tooltip" data-reactors={name} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} {...stylex.props(styles.card)}>
      {url === undefined ? (
        <span aria-hidden {...stylex.props(styles.glyph)}>
          {emoji}
        </span>
      ) : (
        <img src={url} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
      )}
      <div {...stylex.props(styles.words)}>
        <Text variant="ui" tone="default" as="p" sx={styles.sentence} data-reactors-names="">
          {reactorsSentence(line)}
        </Text>
        <div {...stylex.props(styles.foot)}>
          <Text variant="meta" tone="muted" truncate>
            reacted with :{name}:
          </Text>
          {cut && onSeeAll !== undefined ? (
            <Text variant="meta" tone="muted" sx={styles.action}>
              {/* The pointer's way in, so it is not read with the card; the keyboard's is View reactions in the message menu. */}
              <TextButton tone="default" tabIndex={-1} aria-hidden data-see-all="" onPointerDown={seeAll}>
                See all
              </TextButton>
            </Text>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-1-5'],
    boxSizing: 'border-box',
    width: 'max-content',
    minWidth: layout['--reactors-min-width'],
    maxWidth: layout['--menu-width'],
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--surface-raised'],
    color: colors['--foreground-default'],
    boxShadow: shadows['--pop-shadow'],
    userSelect: 'none',
  },
  // The emoji large, as Slack's own card draws it.
  glyph: {
    fontSize: sizes['--control-32'],
    lineHeight: 1,
  },
  image: {
    width: sizes['--control-32'],
    height: sizes['--control-32'],
    objectFit: 'contain',
  },
  words: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    alignSelf: 'stretch',
    minWidth: 0,
  },
  sentence: {
    overflowWrap: 'anywhere',
    textWrap: 'pretty',
  },
  foot: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    minWidth: 0,
  },
  action: {
    flexShrink: 0,
  },
})
