import * as stylex from '@stylexjs/stylex'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import type { ReactNode } from 'react'
import type { Person } from '@juno/contract'
import { colors, radii, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { Avatar, ChannelIcon, Icon, Kbd, OptionGroupLabel, OptionList, OptionRow, Surface, Text, type ChannelColorName, type ChannelIconName, type TextareaMark } from '@juno/ui'
import { Composer } from './Composer'
import { pickerLook } from './DestinationPickers'
import { type HomeProps } from './Home'
import { hueFor, initials } from './look'

/**
 * Round 2 of the merged Home (gallery only, `docs/design/home-merged/round-2`).
 * One composer at the bottom, where every topic's composer is; Juno is the
 * destination until you pick one. Typing @ or # first, with Juno chosen,
 * offers "Send to" rows without taking over: Tab or Enter on a row picks
 * it, Space or Esc keeps the text for Juno. Five ways to lay out what needs
 * you and the people and channels you write to.
 */

export const noop = () => {}

export type RecentKind = 'im' | 'mpim' | 'public' | 'private'

/** A person, group or channel you wrote to lately. */
export interface Recent {
  readonly key: string
  readonly name: string
  readonly kind: RecentKind
  readonly person?: Person
  readonly people?: ReadonlyArray<Person>
  readonly channel?: { readonly id: string; readonly icon?: ChannelIconName; readonly color?: ChannelColorName }
  /** "2h", "Yesterday". */
  readonly at: string
  /** The last line, for the directions that show it: "You: Thursday works". */
  readonly preview?: string
  /** You just sent here from Home. */
  readonly sent?: boolean
}

export type Destination = 'juno' | Recent

/** The "Send to" rows the first @ or # opens. */
export interface SendToPicker {
  readonly kind: 'person' | 'channel'
  readonly rows: ReadonlyArray<Recent>
  readonly active: string
}

export interface WriteState {
  readonly destination: Destination
  readonly draft: string
  readonly marks?: ReadonlyArray<TextareaMark>
  readonly picker?: SendToPicker
}

export interface HomeWriteProps {
  /** Home's scene, greeting and items. */
  readonly home: Omit<HomeProps, 'onAsk' | 'below'>
  readonly people: ReadonlyArray<Recent>
  readonly channels: ReadonlyArray<Recent>
  readonly write: WriteState
  /** The polished version of the direction (round 2's refine step). */
  readonly refined?: boolean
}

export const isChannel = (recent: Recent) => recent.kind === 'public' || recent.kind === 'private'
export const label = (recent: Recent) => (isChannel(recent) ? `#${recent.name}` : recent.name)
export const firstName = (recent: Recent) => (isChannel(recent) || recent.kind === 'mpim' ? recent.name : recent.name.split(' ')[0]!)
export const tintOf = (recent: Recent) => (recent.kind === 'public' ? 'public' : recent.kind === 'private' ? 'private' : 'dm')

const placeholderFor = (destination: Destination) => (destination === 'juno' ? 'Ask Juno, or start with @ or #' : `Message ${label(destination)}`)

// ---------------------------------------------------------------------------
// Marks: a face, a group or a channel's art.

type MarkSize = 44 | 36 | 32 | 28 | 24 | 20 | 18

export function RecentMark({ recent, size }: { readonly recent: Recent; readonly size: MarkSize }) {
  if (recent.channel !== undefined) {
    return <ChannelIcon name={recent.name} id={recent.channel.id} size={size} {...(recent.channel.icon === undefined ? {} : { icon: recent.channel.icon })} {...(recent.channel.color === undefined ? {} : { color: recent.channel.color })} />
  }
  if (recent.kind === 'mpim') return <Avatar kind="group" size={size} label={(recent.people ?? []).map((person) => initials(person.name)[0]).join('')} hue={hueFor(recent.people?.[0]?.color ?? 'plum', recent.key)} />
  const person = recent.person!
  return <Avatar size={size} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl })} />
}

/** Juno's mark beside the people: the sparkle on the warm disc. */
export function JunoMark({ size }: { readonly size: 44 | 36 | 28 | 20 }) {
  return (
    <span {...stylex.props(styles.junoMark, junoMarkSizes[size])}>
      <Icon icon={Sparkle} size={size === 44 ? 20 : size === 36 ? 18 : size === 28 ? 15 : 12} weight="duotone" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// The composer and how it shows the destination.

/** How the composer shows where Enter sends. */
export type DestinationLook = 'chip' | 'glyph' | 'token' | 'to'

/** The destination chip on the field's leading edge: a button that opens the full list. */
export function DestinationChip({ destination }: { readonly destination: Destination }) {
  const juno = destination === 'juno'
  return (
    <button
      type="button"
      aria-label={`Send to: ${juno ? 'Juno' : label(destination)}`}
      aria-haspopup="dialog"
      {...stylex.props(pickerLook.pill, styles.chip, juno ? pickerLook.plain : pickerLook.tints[tintOf(destination)])}
    >
      {juno ? <Icon icon={Sparkle} size={14} weight="duotone" /> : <RecentMark recent={destination} size={18} />}
      <span {...stylex.props(pickerLook.label, styles.chipLabel)}>{juno ? 'Juno' : destination.name}</span>
      <span {...stylex.props(pickerLook.caret)}>
        <Icon icon={CaretDown} size={12} />
      </span>
    </button>
  )
}

function leadingFor(look: DestinationLook, destination: Destination): ReactNode {
  if (look === 'chip') return <DestinationChip destination={destination} />
  if (look === 'glyph') {
    return (
      <span aria-label={`Send to: ${destination === 'juno' ? 'Juno' : label(destination)}`} role="img" {...stylex.props(styles.glyph)}>
        {destination === 'juno' ? <JunoMark size={28} /> : <RecentMark recent={destination} size={28} />}
      </span>
    )
  }
  if (look === 'token' && destination === 'juno') {
    return (
      <span {...stylex.props(styles.glyph)}>
        <JunoMark size={28} />
      </span>
    )
  }
  return undefined
}

/** Mail's "To" line above the field: the destination and the way to change it. */
function ToLine({ destination }: { readonly destination: Destination }) {
  return (
    <div {...stylex.props(styles.toLine)}>
      <Text variant="meta" tone="muted" as="span">
        To
      </Text>
      <DestinationChip destination={destination} />
    </div>
  )
}

export interface HomeComposerProps {
  readonly write: WriteState
  readonly look: DestinationLook
  /** Above the field, inside its column: a band of recents. */
  readonly above?: ReactNode
  readonly refined?: boolean
}

/**
 * The composer at the bottom of Home. With `token` the chosen destination
 * is the first word of the text (`write.marks` carries its chip).
 */
export function HomeComposer({ write, look, above, refined = false }: HomeComposerProps) {
  const { destination, draft, picker } = write
  const leading = leadingFor(look, destination)
  const toLine = look === 'to' ? <ToLine destination={destination} /> : undefined
  const top = above !== undefined && toLine !== undefined ? <div {...stylex.props(styles.aboveStack)}>{above}{toLine}</div> : (above ?? toLine)
  return (
    <Composer
      value={draft}
      onChange={noop}
      onSend={noop}
      placeholder={look === 'token' && destination !== 'juno' ? 'Write your message' : placeholderFor(destination)}
      {...(top === undefined ? {} : { above: top })}
      {...(leading === undefined ? {} : { leading })}
      {...(write.marks === undefined ? {} : { marks: write.marks })}
      {...(picker === undefined
        ? {}
        : {
            mention: {
              anchorAt: 0,
              listId: 'send-to',
              activeId: `send-to-${picker.active}`,
              list: <SendToList picker={picker} refined={refined} />,
              onDismiss: noop,
            },
          })}
    />
  )
}

/**
 * The rows the first @ or # opens while Juno is chosen. It suggests and
 * never takes over: the text stays in the field, Tab or Enter on a row
 * makes that row the destination, Space or Esc closes the list and keeps
 * the text for Juno. The footer says so.
 */
export function SendToList({ picker, refined = false }: { readonly picker: SendToPicker; readonly refined?: boolean }) {
  const active = picker.rows.find((row) => row.key === picker.active)
  return (
    <div data-send-to="" {...stylex.props(styles.sendTo)}>
      <Surface kind="popover">
        <OptionList id="send-to" label="Send to" activeId={`send-to-${picker.active}`}>
          <OptionGroupLabel>{picker.kind === 'person' ? 'Send to a person' : 'Send to a channel'}</OptionGroupLabel>
          {picker.rows.map((row) => (
            <OptionRow
              key={row.key}
              id={`send-to-${row.key}`}
              size={32}
              active={row.key === picker.active}
              leading={<RecentMark recent={row} size={20} />}
              label={row.name}
              sub={row.kind === 'im' ? 'Direct message' : row.kind === 'mpim' ? 'Group' : row.kind === 'private' ? 'Private channel' : 'Public channel'}
              onSelect={noop}
              onActivate={noop}
            />
          ))}
        </OptionList>
        <div {...stylex.props(styles.sendToFoot)}>
          <span {...stylex.props(styles.hint)}>
            <Kbd look="key">Tab</Kbd>
            <Text variant="meta" tone="muted" as="span" truncate>
              Send to {active === undefined ? 'it' : label(active)}
            </Text>
          </span>
          <span {...stylex.props(styles.hint)}>
            <Kbd look="key">Space</Kbd>
            <Text variant="meta" tone="muted" as="span">
              {refined ? 'Keep as text' : 'Ask Juno'}
            </Text>
          </span>
        </div>
      </Surface>
    </div>
  )
}

// One-off sizes for these proposals; a chosen direction promotes the ones it keeps to tokens.
const CHIP_LABEL_MAX = '180px'
const SEND_TO_WIDTH = '320px'

const junoMarkSizes = stylex.create({
  44: { width: sizes['--tile-44'], height: sizes['--tile-44'] },
  36: { width: sizes['--tile-36'], height: sizes['--tile-36'] },
  28: { width: sizes['--avatar-28'], height: sizes['--avatar-28'] },
  20: { width: sizes['--avatar-20'], height: sizes['--avatar-20'] },
})

const styles = stylex.create({
  junoMark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radii['--radius-pill'],
    backgroundColor: colors['--warm-soft'],
    color: colors['--foreground-default'],
  },
  chip: {
    flexShrink: 0,
    marginBlock: spacing['--space-1-5'],
    paddingInlineStart: spacing['--space-1-5'],
  },
  chipLabel: {
    maxWidth: CHIP_LABEL_MAX,
  },
  glyph: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    height: sizes['--control-40'],
    marginBlock: '-1px', // tokens-allow: The composer row overlaps the field border by one pixel.
  },
  toLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    paddingInlineStart: spacing['--space-3-5'],
  },
  aboveStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    width: '100%',
    minWidth: 0,
  },
  sendTo: {
    position: 'absolute',
    zIndex: z['--z-mention'],
    width: SEND_TO_WIDTH,
    bottom: 'anchor(--composer-box top)',
    left: 'anchor(--composer-box left)',
    marginBottom: spacing['--space-1-5'],
  },
  sendToFoot: {
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
