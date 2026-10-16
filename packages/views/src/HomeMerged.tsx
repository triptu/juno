import * as stylex from '@stylexjs/stylex'
import { At } from '@phosphor-icons/react/dist/icons/At'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { ChatText } from '@phosphor-icons/react/dist/icons/ChatText'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useEffect } from 'react'
import type { PickConversation, PickThread } from '@juno/contract'
import { accent, colors, layout, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, Text, tooltip, type PhosphorIcon } from '@juno/ui'
import { Composer } from './Composer'
import { DestinationPickers, pickerLook } from './DestinationPickers'
import { FrequentConversations, loadFrequentRows } from './FrequentConversations'
import { Home, type HomeProps } from './Home'
import { hueFor, initials } from './look'

/**
 * Proposals for Home merged with New chat (gallery only; nothing in the app
 * uses these yet). Each direction composes the real Home, Composer,
 * DestinationPickers and Frequent rows, so the owner judges real sizes.
 */

const noop = () => {}

export interface MergedProps {
  /** Home's own props: scene, greeting, items. `onAsk` is set by the direction. */
  readonly home: Omit<HomeProps, 'onAsk' | 'below'>
  /** Up to six, ranked as New chat's Frequent. Empty on a first run. */
  readonly frequent: ReadonlyArray<PickConversation>
  /** The chosen conversation; none is Juno in A and "not picked" in B and C. */
  readonly conversation?: PickConversation | undefined
  readonly thread?: PickThread | undefined
  readonly draft?: string
  readonly now: number
}

const placeholderFor = (conversation: PickConversation | undefined, thread: PickThread | undefined, none: string) =>
  conversation === undefined ? none : thread !== undefined ? 'Reply' : conversation.kind === 'public' || conversation.kind === 'private' ? `Message #${conversation.name}` : `Message ${conversation.name}`

const pickers = (conversation: PickConversation | undefined, thread: PickThread | undefined, now: number) => (
  <DestinationPickers conversation={conversation} thread={thread} open={undefined} onOpen={noop} query="" onQuery={noop} conversations={undefined} threads={undefined} now={now} onPickConversation={noop} onPickThread={noop} />
)

/**
 * A · One field. Juno is the first destination, so "Ask Juno" and "write a
 * message" are one composer. The destination row above the field holds
 * Juno, the top three Frequent and "Someone else"; the chosen one takes its
 * context tint. ⌘J focuses the field with Juno chosen, ⌘N with the
 * conversation list open.
 */
export function HomeOneField({ home, frequent, conversation, thread, draft = '' }: MergedProps) {
  const top = frequent.slice(0, 3)
  const shown = conversation === undefined || top.some((candidate) => candidate.key === conversation.key) ? top : [conversation, ...top.slice(0, 2)]
  const row = (
    <div role="group" aria-label="Send to" {...stylex.props(styles.chipRow)}>
      <DestinationChip label="Juno" icon={Sparkle} duotone selected={conversation === undefined} />
      {shown.map((candidate) => (
        <DestinationChip key={candidate.key} conversation={candidate} label={candidate.name} selected={candidate.key === conversation?.key} />
      ))}
      <DestinationChip label="Someone else" icon={At} iconOnly caret />
      {conversation === undefined ? null : (
        <span {...stylex.props(styles.threadEnd)}>
          <DestinationChip label={thread?.title ?? 'Main'} icon={ChatText} caret />
        </span>
      )}
    </div>
  )
  return (
    <div {...stylex.props(styles.stack)}>
    <Home
      {...home}
      below={
        <div {...stylex.props(styles.inColumn)}>
          <Composer
            value={draft}
            onChange={noop}
            onSend={noop}
            placeholder={placeholderFor(conversation, thread, 'Ask Juno, or pick who to write to')}
            above={row}
          />
        </div>
      }
    />
    </div>
  )
}

/**
 * B · Composer at the foot. Home stays as it is, Ask Juno included; the
 * New chat composer sits at the bottom, where every topic's composer is.
 * The pickers lead its row and Frequent trails it as faces, one press each.
 */
export function HomeFoot({ home, frequent, conversation, thread, draft = '', now }: MergedProps) {
  return (
    <div {...stylex.props(styles.stack)}>
      <Home {...home} onAsk={noop} />
      <Composer
        value={draft}
        onChange={noop}
        onSend={noop}
        placeholder={placeholderFor(conversation, thread, 'Write a message')}
        above={
          <div {...stylex.props(styles.footRow)}>
            {pickers(conversation, thread, now)}
            {frequent.length === 0 ? null : (
              <div role="group" aria-label="Frequent" {...stylex.props(styles.faces)}>
                {frequent.map((candidate) => (
                  <Face key={candidate.key} conversation={candidate} selected={candidate.key === conversation?.key} />
                ))}
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}

/**
 * C · Two columns. What needs you on the left, as Home shows it; writing on
 * the right, as New chat shows it: Frequent rows, then the pickers and the
 * composer. Below 880px wide the columns stack, writing second.
 */
export function HomeSplit({ home, frequent, conversation, thread, draft = '', now }: MergedProps) {
  useEffect(() => {
    void loadFrequentRows()
  }, [])
  return (
    <div {...stylex.props(styles.splitScope)}>
    <div {...stylex.props(styles.split)}>
      <div {...stylex.props(styles.splitHome)}>
        <Home {...home} onAsk={noop} />
      </div>
      <div {...stylex.props(styles.writeColumn)}>
        {frequent.length === 0 ? (
          <Text variant="meta" tone="muted" as="p" sx={styles.writeHint}>
            Write your message, then pick where it goes.
          </Text>
        ) : (
          <div {...stylex.props(styles.writeInset)}>
            <FrequentConversations conversations={frequent} selected={conversation?.key} onPick={noop} />
          </div>
        )}
        <div {...stylex.props(styles.writeComposer)}>
          <Composer value={draft} onChange={noop} onSend={noop} placeholder={placeholderFor(conversation, thread, 'Write a message')} above={pickers(conversation, thread, now)} />
        </div>
      </div>
    </div>
    </div>
  )
}

const kindIcon = (conversation: PickConversation): PhosphorIcon => (conversation.kind === 'private' ? Lock : conversation.kind === 'mpim' ? Users : Hash)

function Mark({ conversation, size }: { readonly conversation: PickConversation; readonly size: 18 | 24 }) {
  const person = conversation.person
  if (person === undefined) return <Icon icon={kindIcon(conversation)} size={size === 18 ? 13 : 15} />
  return <Avatar size={size} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
}

interface DestinationChipProps {
  readonly label: string
  readonly conversation?: PickConversation
  readonly icon?: PhosphorIcon
  readonly duotone?: boolean
  readonly iconOnly?: boolean
  readonly caret?: boolean
  readonly selected?: boolean
}

/** A destination in A's row: the picker pill's look, tinted when chosen. */
function DestinationChip({ label, conversation, icon, duotone = false, iconOnly = false, caret = false, selected = false }: DestinationChipProps) {
  const tint = selected ? conversation?.tint : undefined
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={caret ? undefined : selected}
      aria-haspopup={caret ? 'dialog' : undefined}
      {...(iconOnly ? tooltip(label) : {})}
      {...stylex.props(pickerLook.pill, styles.chip, iconOnly && styles.chipIconOnly, selected ? (tint === undefined ? pickerLook.plain : pickerLook.tints[tint]) : styles.chipIdle)}
    >
      {conversation === undefined ? <Icon icon={icon ?? At} size={13} {...(duotone ? { weight: 'duotone' as const } : {})} /> : <Mark conversation={conversation} size={18} />}
      {iconOnly ? null : <span {...stylex.props(pickerLook.label)}>{label}</span>}
      {caret && !iconOnly ? (
        <span {...stylex.props(pickerLook.caret)}>
          <Icon icon={CaretDown} size={12} />
        </span>
      ) : null}
    </button>
  )
}

/** B's Frequent: a 28px round button with the face or the channel glyph; the name is its tooltip. */
function Face({ conversation, selected }: { readonly conversation: PickConversation; readonly selected: boolean }) {
  const name = conversation.person === undefined && conversation.kind !== 'mpim' ? `#${conversation.name}` : conversation.name
  return (
    <button type="button" aria-label={name} aria-pressed={selected} {...tooltip(name)} {...stylex.props(styles.face, selected && styles.faceChosen)}>
      <Mark conversation={conversation} size={24} />
    </button>
  )
}

const HOVER = '@media (hover: hover)'
// Composer pads itself for the bottom of a page; inside a column its field lines up with the column's edges.
const composerInset = `calc(-1 * ${spacing['--space-6']})`

const styles = stylex.create({
  inColumn: {
    width: `calc(100% + 2 * ${spacing['--space-6']})`,
    maxWidth: `calc(${layout['--home-width']} + 2 * ${spacing['--space-6']})`,
    marginTop: spacing['--space-4'],
    marginInline: composerInset,
    marginBottom: `calc(-1 * ${spacing['--space-5']})`,
  },
  chipRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    width: '100%',
    minWidth: 0,
  },
  threadEnd: {
    display: 'inline-flex',
    minWidth: 0,
    marginInlineStart: 'auto',
  },
  // Room for an 18px face at the start.
  chip: {
    flexShrink: 1,
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-2-5'],
  },
  chipIconOnly: {
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-28'],
    paddingInline: 0,
  },
  chipIdle: {
    color: colors['--foreground-subtle'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--secondary-default'] } },
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  footRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    width: '100%',
    minWidth: 0,
  },
  faces: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
    marginInlineStart: 'auto',
  },
  face: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-28'],
    height: sizes['--control-28'],
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-pill'],
    color: colors['--foreground-subtle'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--secondary-default'] } },
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
    transform: { default: 'none', ':active': `scale(${motion['--press-scale']})` },
    transitionProperty: 'transform',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  faceChosen: {
    backgroundColor: colors['--secondary-active'],
  },
  splitScope: {
    width: '100%',
    height: '100%',
    minHeight: 0,
    overflowY: 'auto',
    containerType: 'inline-size',
    backgroundColor: colors['--background'],
  },
  split: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@container (min-width: 880px)': 'minmax(0, 1fr) minmax(0, 1fr)' },
    alignItems: 'center',
    columnGap: spacing['--space-6'],
    minHeight: '100%',
    paddingInline: spacing['--space-6'],
    boxSizing: 'border-box',
  },
  splitHome: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  // Frequent's rows, the hint and the composer's field share one start edge.
  writeColumn: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: `calc(${layout['--home-width']} + 2 * ${spacing['--space-6']})`,
    minWidth: 0,
    marginInline: 'auto',
    paddingBlock: spacing['--space-12'],
    boxSizing: 'border-box',
  },
  writeInset: {
    paddingInline: spacing['--space-6'],
  },
  writeHint: {
    margin: 0,
    paddingInline: `calc(${spacing['--space-6']} + ${spacing['--space-3']})`,
  },
  writeComposer: {
    marginTop: spacing['--space-3'],
  },
})


