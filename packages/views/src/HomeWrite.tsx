import * as stylex from '@stylexjs/stylex'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { PickConversation } from '@juno/contract'
import { accent, colors, layout, radii, sizes, spacing, text, tints, weights, z } from '@juno/tokens/tokens.stylex'
import { Avatar, ChannelIcon, Icon, Kbd, OptionGroupLabel, OptionList, OptionRow, Surface, Text } from '@juno/ui'
import { channelIconFor, hueFor, initials } from './look'

/**
 * Home's writing block (SPEC section 12, "Writing"): Recent, then the
 * destination chip, then the field, as one stack at the bottom of Home on
 * the composer's left edge. The container puts `HomeWriteTop` in the
 * composer's `above` slot and `SendToList` in its suggestions slot.
 */

const isChannel = (conversation: PickConversation) => conversation.kind === 'public' || conversation.kind === 'private'
/** "#eng" or "Maya Chen": as the chip and the list's footer name it. */
export const destinationLabel = (conversation: PickConversation): string => (isChannel(conversation) ? `#${conversation.name}` : conversation.name)

/** A face, a group's initials or a channel's art, at 20px. */
function DestinationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person !== undefined) return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
  if (conversation.kind === 'mpim') return <Avatar kind="group" size={20} label={initials(conversation.name)} hue={hueFor('', conversation.key)} />
  const icon = conversation.icon === undefined ? undefined : channelIconFor(conversation.icon)
  return <ChannelIcon name={conversation.name} id={conversation.channelId ?? conversation.key} size={20} {...(icon === undefined ? {} : { icon })} {...(conversation.color === undefined ? {} : { color: hueFor(conversation.color, conversation.key) })} />
}

export interface HomeRecentProps {
  /** DMs and group DMs, at most five. */
  readonly people: ReadonlyArray<PickConversation>
  /** Channels, at most five. */
  readonly channels: ReadonlyArray<PickConversation>
  /** The chosen destination's key: its row takes the destination's tint. */
  readonly chosen?: string | undefined
  /** Makes it the destination. */
  readonly onPick: (conversation: PickConversation) => void
  /** ⌘-click or ⌘Enter: opens the conversation instead. */
  readonly onOpen: (conversation: PickConversation) => void
  /** Keep Recent's space while its rows may still arrive (the first sync), so the chip and the field never move. */
  readonly reserve?: boolean
}

/**
 * Recent: one quiet label over two columns, people on the left and
 * channels on the right; faces against channel art make the split. One
 * Tab stop: ↑ ↓ move within a column, ← → between them, Enter or Space
 * picks, ⌘Enter opens. A press keeps focus where it was, so the field keeps
 * the caret. Below about 400px the columns stack. Each column keeps room for
 * five rows, so rows that arrive later fill it and nothing above moves.
 */
export function HomeRecent({ people, channels, chosen, onPick, onOpen, reserve = false }: HomeRecentProps) {
  // Both columns always take their place, so one that fills later moves nothing; the keys skip an empty one.
  const lists = [people, channels]
  const filled = lists.flatMap((list, index) => (list.length > 0 ? [index] : []))
  const [at, setAt] = useState<readonly [number, number]>([0, 0])
  if (filled.length === 0 && !reserve) return null
  // Waiting for its rows: the same box, empty and hidden, so it takes exactly Recent's room.
  if (filled.length === 0) {
    return (
      <div aria-hidden="true" data-home-recent-reserved="" {...stylex.props(styles.recent, styles.hidden)}>
        <Text variant="sectionLabel" tone="muted" as="div" sx={styles.label}>
          Recent
        </Text>
        <div {...stylex.props(styles.scope)}>
          <div {...stylex.props(styles.columns)}>
            <div {...stylex.props(styles.list)} />
            <div {...stylex.props(styles.list)} />
          </div>
        </div>
      </div>
    )
  }
  const column = filled.includes(at[0]) ? at[0] : filled[0]!
  const row = Math.min(at[1], lists[column]!.length - 1)
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const step: Record<string, readonly [number, number]> = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }
    const by = step[event.key]
    if (by === undefined) return
    event.preventDefault()
    const place = filled.indexOf(column)
    const nextColumn = filled[Math.max(0, Math.min(filled.length - 1, place + by[0]))]!
    const nextRow = Math.max(0, Math.min(lists[nextColumn]!.length - 1, by[0] === 0 ? row + by[1] : row))
    setAt([nextColumn, nextRow])
    const list = event.currentTarget.closest('[data-home-recent]')
    list?.querySelector<HTMLElement>(`[data-recent="${nextColumn}-${nextRow}"]`)?.focus()
  }
  return (
    <section aria-labelledby="home-recent" data-home-recent="" {...stylex.props(styles.recent)}>
      <Text id="home-recent" variant="sectionLabel" tone="muted" as="h3" sx={styles.label}>
        Recent
      </Text>
      <div {...stylex.props(styles.scope)}>
        <div {...stylex.props(styles.columns)}>
          {lists.map((list, c) => (
            <ul key={c === 0 ? 'people' : 'channels'} aria-label={c === 0 ? 'People' : 'Channels'} {...stylex.props(styles.list)}>
              {list.map((conversation, r) => (
                <li key={conversation.key}>
                  <button
                    type="button"
                    data-recent={`${c}-${r}`}
                    aria-pressed={conversation.key === chosen}
                    tabIndex={c === column && r === row ? 0 : -1}
                    onMouseDown={(event: MouseEvent) => {
                      if (event.button === 0) event.preventDefault()
                    }}
                    onClick={(event) => (event.metaKey ? onOpen(conversation) : onPick(conversation))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && event.metaKey) {
                        event.preventDefault()
                        onOpen(conversation)
                        return
                      }
                      move(event)
                    }}
                    onFocus={() => setAt([c, r])}
                    {...stylex.props(styles.row, conversation.key === chosen && tintRows[conversation.tint])}
                  >
                    <span {...stylex.props(styles.markSlot)}>
                      <DestinationMark conversation={conversation} />
                    </span>
                    <span {...stylex.props(styles.name)}>{conversation.name}</span>
                    {conversation.kind === 'private' ? (
                      <span {...stylex.props(styles.lock)}>
                        <Icon icon={Lock} size={12} label="Private" />
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Recent, then the destination chip, as one stack above the field. */
export function HomeWriteTop({ recent, chip }: { readonly recent: ReactNode; readonly chip: ReactNode }) {
  return (
    <div data-home-write="" {...stylex.props(styles.top)}>
      {recent}
      <div {...stylex.props(styles.chipRow)}>{chip}</div>
    </div>
  )
}

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

/** A row's element id in `SendToList`, for `aria-activedescendant`. */
export const sendToRowId = (listId: string, key: string) => `${listId}-${key}`

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

const HOVER = '@media (hover: hover)'
/** Rows per Recent column (`frequentDestinations`). */
const RECENT_ROWS = 5
const FOLD = '@container (max-width: 400px)'

const tintRows = stylex.create({
  public: { backgroundColor: tints['--tint-public-bg'], color: tints['--tint-public-fg'] },
  private: { backgroundColor: tints['--tint-private-bg'], color: tints['--tint-private-fg'] },
  dm: { backgroundColor: tints['--tint-dm-bg'], color: tints['--tint-dm-fg'] },
})

const styles = stylex.create({
  // Recent, the chip and the field read as one stack: a wider gap under Recent, the chip close to the field it labels.
  top: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    width: '100%',
    minWidth: 0,
  },
  chipRow: {
    display: 'flex',
    minWidth: 0,
  },
  // As wide as Home's column; it starts on the field's edge.
  recent: {
    width: '100%',
    maxWidth: layout['--home-width'],
  },
  // On the edge of the rows' marks.
  label: {
    margin: 0,
    paddingInline: spacing['--space-4'],
    paddingBottom: spacing['--space-1'],
  },
  scope: {
    containerType: 'inline-size',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr)', [FOLD]: 'minmax(0, 1fr)' },
    columnGap: spacing['--space-2'],
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: `calc(${RECENT_ROWS} * ${sizes['--control-32']})`,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  hidden: {
    visibility: 'hidden',
  },
  // Recent sits below what needs you: the subtle tone at rest, the default on hover and when chosen.
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    width: '100%',
    height: sizes['--control-32'],
    minWidth: 0,
    paddingInline: spacing['--space-1-5'],
    borderWidth: 0,
    borderRadius: radii['--radius-xl'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--surface-hover'] } },
    color: { default: colors['--foreground-subtle'], ':hover': { default: null, [HOVER]: colors['--foreground-default'] } },
    textAlign: 'start',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  // As wide as a Needs you row's art, so the 20px mark sits on its axis.
  markSlot: {
    display: 'inline-flex',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-40'],
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    fontWeight: weights['--weight-regular'],
    lineHeight: text['--text-ui-leading'],
  },
  lock: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
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
