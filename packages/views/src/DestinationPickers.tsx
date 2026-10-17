import * as stylex from '@stylexjs/stylex'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { At } from '@phosphor-icons/react/dist/icons/At'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import type { ConversationKind, PickConversation, PickConversations } from '@juno/contract'
import { accent, colors, motion, radii, sizes, spacing, text, tints } from '@juno/tokens/tokens.stylex'
import { Avatar, chunk, Icon, Popover, SparkleDuotone, type PhosphorIcon } from '@juno/ui'
import { hueFor, initials } from './look'

const lists = chunk(() => import('./DestinationLists'))
const loadLists = lists.load
const ConversationList = lists.component((module) => module.ConversationList)

const kindIcons: Record<ConversationKind, PhosphorIcon> = { public: Hash, private: Lock, im: User, mpim: Users }

export interface DestinationChipProps {
  /** Where Enter sends; none is Juno. */
  readonly destination: PickConversation | undefined
  /** Juno is a destination (AI assist on). Without it, nothing chosen reads "Pick a conversation". Default true. */
  readonly juno?: boolean
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
  /** The list's search text. */
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The list's sections; undefined while they load. */
  readonly conversations: PickConversations | undefined
  readonly loading?: boolean
  /** A conversation, or Juno with `undefined`. */
  readonly onPick: (conversation: PickConversation | undefined) => void
  readonly buttonRef?: Ref<HTMLButtonElement>
  /** A printable key typed on the closed chip: the owner moves focus to the field and types it there, as a token field does. */
  readonly onType?: (text: string) => void
}

/**
 * Home's destination (SPEC section 12, "Writing"): one chip just above the
 * composer, on its left edge, so the field's text has its full width. It
 * says Juno until a person or channel is chosen, then takes the context
 * pill's tint (neutral, amber for private, blue for DMs) and the face or
 * the channel's mark. The chip's slot is always there, so a change moves
 * nothing; the new name rises into it once, briefly. It opens the
 * destination list above itself, Juno first.
 */
export function DestinationChip({ destination, juno = true, open, onOpen, query, onQuery, conversations, loading, onPick, buttonRef, onType }: DestinationChipProps) {
  useEffect(() => {
    const idle = requestIdleCallback(() => void loadLists(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  const none = juno ? 'Juno' : 'Pick a conversation'
  const label = destination === undefined ? none : destination.kind === 'public' || destination.kind === 'private' ? `#${destination.name}` : destination.name
  return (
    <Popover
      open={open}
      onClose={() => onOpen(false)}
      placement="top-start"
      width="picker"
      maxHeight="none"
      layer="picker"
      padding="none"
      label="Send to"
      anchor={
        <PickerButton
          ref={buttonRef}
          label={`Send to: ${label}`}
          icon={destination === undefined ? (juno ? SparkleDuotone : At) : kindIcons[destination.kind]}
          {...(destination?.person === undefined ? {} : { leading: <PersonMark person={destination.person} /> })}
          tint={destination?.tint}
          muted={destination === undefined && !juno}
          wide
          expanded={open}
          onOpen={() => onOpen(!open)}
          {...(onType === undefined ? {} : { onType })}
          change={destination?.key ?? 'juno'}
        >
          {destination?.name ?? none}
        </PickerButton>
      }
    >
      {open ? (
        <ConversationList
          query={query}
          onQuery={onQuery}
          conversations={conversations}
          loading={loading}
          onPickConversation={(conversation) => onPick(conversation)}
          onClose={() => onOpen(false)}
          {...(juno ? { onJuno: () => onPick(undefined) } : {})}
          selected={destination?.key ?? JUNO_KEY}
        />
      ) : null}
    </Popover>
  )
}

/** The key the list's Juno row is selected by. */
const JUNO_KEY = 'juno'

function PersonMark({ person }: { readonly person: NonNullable<PickConversation['person']> }) {
  return <Avatar size={18} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
}

/** The place a list is narrowed to, as its button shows it. */
export interface PlacePick {
  readonly id: string
  readonly name: string
  readonly kind: ConversationKind
  readonly tint: PickConversation['tint']
}

export interface PlacePickerProps {
  /** Undefined is Anywhere. */
  readonly place: PlacePick | undefined
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The list's sections, already narrowed to the places that apply; undefined while they load. */
  readonly conversations: PickConversations | undefined
  readonly loading?: boolean
  /** A conversation, or Anywhere with `undefined`. */
  readonly onPick: (conversation: PickConversation | undefined) => void
}

/**
 * A place filter (All topics, spec section 11): Home's destination
 * button and searchable list, opening below the button, with Anywhere as
 * the list's first row. The button takes the place's tint once one is
 * picked.
 */
export function PlacePicker({ place, open, onOpen, query, onQuery, conversations, loading, onPick }: PlacePickerProps) {
  useEffect(() => {
    const idle = requestIdleCallback(() => void loadLists(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  const button = useRef<HTMLButtonElement>(null)
  const label = place?.name ?? 'Anywhere'
  // A pick puts focus back on the button, as Esc does.
  const pick = (conversation: PickConversation | undefined) => {
    onPick(conversation)
    button.current?.focus()
  }
  return (
    <Popover
      open={open}
      onClose={() => onOpen(false)}
      placement="bottom-start"
      width="picker"
      maxHeight="none"
      layer="picker"
      padding="none"
      label="Pick a place"
      anchor={
        <PickerButton ref={button} label={`Where: ${label}`} icon={place === undefined ? Globe : kindIcons[place.kind]} tint={place?.tint} muted={place === undefined} wide expanded={open} onOpen={() => onOpen(!open)}>
          {label}
        </PickerButton>
      }
    >
      {open ? (
        <ConversationList
          query={query}
          onQuery={onQuery}
          conversations={conversations}
          loading={loading}
          onPickConversation={pick}
          onClose={() => onOpen(false)}
          onAnywhere={() => pick(undefined)}
          selected={place?.id}
        />
      ) : null}
    </Popover>
  )
}

interface PickerButtonProps {
  readonly ref?: Ref<HTMLButtonElement> | undefined
  readonly label: string
  readonly icon: PhosphorIcon
  /** In place of the icon: a person's face. */
  readonly leading?: ReactNode
  /** A key that changes with what the button names: the name rises in once when it changes (not on first paint). */
  readonly change?: string
  /** A picked conversation's context tint. */
  readonly tint?: PickConversation['tint'] | undefined
  /** Nothing picked: subtle text. Default: no tint. */
  readonly muted?: boolean
  /** The thread title may run longer before it takes an ellipsis. */
  readonly wide?: boolean
  readonly expanded: boolean
  readonly onOpen: () => void
  /** A printable key (not Space, which presses the button) typed while the list is closed. */
  readonly onType?: (text: string) => void
  readonly children: ReactNode
}

function PickerButton({ ref, label, icon, leading, change, tint, muted, wide = false, expanded, onOpen, onType, children }: PickerButtonProps) {
  const subtle = muted ?? tint === undefined
  // The name shown first never rises; any later one does.
  const [first] = useState(change)
  const rises = change !== undefined && change !== first
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (expanded) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onOpen()
    } else if (onType !== undefined && !event.metaKey && !event.ctrlKey && [...event.key].length === 1 && event.key !== ' ') {
      event.preventDefault()
      onType(event.key)
    }
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onPointerEnter={() => void loadLists()}
      onFocus={() => void loadLists()}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.button, tint === undefined ? (subtle ? styles.unset : styles.plain) : tintStyles[tint])}
    >
      <span key={change} {...stylex.props(styles.face, rises && styles.rise)}>
        {leading ?? <Icon icon={icon} size={13} />}
        <span {...stylex.props(styles.buttonLabel, wide && styles.buttonLabelWide)}>{children}</span>
      </span>
      <span {...stylex.props(styles.caret)}>
        <Icon icon={CaretDown} size={12} />
      </span>
    </button>
  )
}

/** The longest a place's name runs in its button before the ellipsis. */
const THREAD_LABEL_MAX = '260px'

// The new destination rises 4px into the chip with the fade; with reduced motion it only fades.
const rise = stylex.keyframes({
  from: { opacity: 0, transform: 'var(--picker-rise-from)' },
  to: { opacity: 1, transform: 'none' },
})


const styles = stylex.create({
  face: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  rise: {
    '--picker-rise-from': { default: 'none', '@media (prefers-reduced-motion: no-preference)': `translateY(${spacing['--space-1']})` },
    animationName: rise,
    animationDuration: motion['--duration-fast'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    height: sizes['--control-28'],
    minWidth: 0,
    paddingInlineStart: spacing['--space-2-5'],
    paddingInlineEnd: spacing['--space-2'],
    borderWidth: 0,
    borderRadius: radii['--radius-pill'],
    fontFamily: text['--text-pill-family'],
    fontSize: text['--text-pill-size'],
    fontWeight: text['--text-pill-weight'],
    lineHeight: text['--text-pill-leading'],
    whiteSpace: 'nowrap',
    cursor: 'default',
    userSelect: 'none',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
    transform: { default: 'none', ':active': `scale(${motion['--press-scale']})` },
    transitionProperty: 'transform',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  unset: {
    color: colors['--foreground-subtle'],
    backgroundColor: { default: colors['--secondary-default'], ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] } },
  },
  plain: {
    color: colors['--foreground-default'],
    backgroundColor: { default: colors['--secondary-default'], ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] } },
  },
  buttonLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  buttonLabelWide: {
    maxWidth: THREAD_LABEL_MAX,
  },
  caret: {
    display: 'inline-flex',
    color: colors['--foreground-muted'],
  },
})

const tintStyles = stylex.create({
  public: { color: tints['--tint-public-fg'], backgroundColor: tints['--tint-public-bg'] },
  private: { color: tints['--tint-private-fg'], backgroundColor: tints['--tint-private-bg'] },
  dm: { color: tints['--tint-dm-fg'], backgroundColor: tints['--tint-dm-bg'] },
})


