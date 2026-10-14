import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ReactNode } from 'react'
import { chatCopy, type CardId, type CardKind, type CardStatus, type OpenTarget, type Place, type PlaceTint } from '@juno/agent-contract'
import { chat, colors, motion, opacity, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, IconButton, Surface, Text, type PhosphorIcon } from '@juno/ui'
import type { ChatActions } from '../commands'
import { TextButton } from '../TextButton'

export interface ChatCardProps {
  readonly id: CardId
  readonly kind: CardKind
  readonly actions: ChatActions
  /** The header's kind label. Default: `chatCopy.card.kind[kind]`. */
  readonly label?: string
  /** After the kind label and a dot: a context pill, a job, a server. */
  readonly source?: ReactNode
  /** Absent only on a `task` card, whose phase drives its own footer. */
  readonly status?: CardStatus
  readonly because?: string
  /** The card offers Dismiss: the header X while `open`, and the ghost button in the footer. */
  readonly dismiss?: boolean
  /** The footer's buttons while the card is `open` or `working`. */
  readonly buttons?: ReactNode
  /** Leave out the footer slot altogether: a card with no buttons and no outcome (topics, unknown). */
  readonly footer?: boolean
  /** The card's padding: `normal` 14 16; `tight` 8, for the topics list. */
  readonly padding?: 'normal' | 'tight'
  /** Play the fade on mount. Pass false for a card drawn in a settled state (the review page, the gallery). */
  readonly enter?: boolean
  readonly children?: ReactNode
}

/**
 * The shell every card shares (inventory 12): the header line, the body,
 * the "Because" and "may already have happened" lines, and the footer,
 * which holds the buttons while the card is open and the after-line once
 * it has settled. The footer keeps its height through that change, so a
 * click never moves what is under the card. A `working` card dims its
 * buttons; the view never composes an after-line, it prints `status.line`.
 */
export function ChatCard({ id, kind, actions, label, source, status, because, dismiss = false, buttons, footer = true, padding = 'normal', enter = true, children }: ChatCardProps) {
  const open = status === undefined || status._tag === 'open'
  const working = status?._tag === 'working'
  return (
    <Surface kind="card" as="article" padding="none" data-chat-card={kind} data-card-status={status?._tag} aria-busy={working || undefined} sx={enter ? styles.cardEnter : styles.card}>
      <div {...stylex.props(styles.inner, padding === 'tight' && styles.innerTight)}>
      <div {...stylex.props(styles.header, padding === 'tight' && styles.headerTight)}>
        <Text variant="meta" weight="medium" tone="subtle" truncate>
          {label ?? chatCopy.card.kind[kind]}
        </Text>
        {source !== undefined ? (
          <>
            <span aria-hidden>·</span>
            {source}
          </>
        ) : null}
        {dismiss && open ? (
          <span {...stylex.props(styles.dismiss)}>
            <IconButton icon={X} label={chatCopy.card.dismiss} size={22} radius="sm" iconSize={12} tone="muted" onClick={() => actions.onCard(id, { _tag: 'dismiss' })} />
          </span>
        ) : null}
      </div>
      {children}
      {because !== undefined ? (
        <Text variant="meta" tone="muted" as="p" sx={styles.line}>
          {chatCopy.card.because}
          {because}
        </Text>
      ) : null}
      {status?._tag === 'open' && status.mayHaveHappened ? (
        <Text variant="meta" tone="muted" as="p" sx={styles.line}>
          {chatCopy.card.may}
        </Text>
      ) : null}
      {footer ? (
        <div {...stylex.props(styles.footer)}>
          {status === undefined || open || working ? (
            <div aria-disabled={working || undefined} {...stylex.props(styles.buttons, working && styles.working)}>
              {buttons}
              {dismiss ? (
                <Button variant="ghost" size="md" tone="subtle" onClick={() => actions.onCard(id, { _tag: 'dismiss' })}>
                  {chatCopy.card.dismiss}
                </Button>
              ) : null}
            </div>
          ) : (
            <AfterLine id={id} status={status} actions={actions} />
          )}
        </div>
      ) : null}
      </div>
    </Surface>
  )
}

/** What a settled card prints where its buttons were. */
function AfterLine({ id, status, actions }: { readonly id: CardId; readonly status: CardStatus; readonly actions: ChatActions }) {
  const copy = chatCopy.card
  switch (status._tag) {
    case 'open':
    case 'working':
      return null
    case 'dismissed':
      return <After>{copy.dismissed}</After>
    case 'expired':
      return (
        <After>
          {copy.expired} · <TextButton onClick={() => actions.onCard(id, { _tag: 'askAgain' })}>{copy.askAgain}</TextButton>
        </After>
      )
    case 'done':
      return (
        <After>
          {status.line}
          {status.undo ? (
            <>
              {' · '}
              <TextButton onClick={() => actions.onCard(id, { _tag: 'undo' })}>{chatCopy.note.undo}</TextButton>
            </>
          ) : null}
          {status.open !== undefined ? (
            <>
              {' · '}
              <OpenButton target={status.open} actions={actions} />
            </>
          ) : null}
        </After>
      )
    case 'failed':
      return (
        <After>
          {status.line}
          {status.retry ? (
            <>
              {' · '}
              <TextButton onClick={() => actions.onCard(id, { _tag: 'retry' })}>{chatCopy.ending.tryAgain}</TextButton>
            </>
          ) : null}
          {status.mayDuplicate && status.retry ? <MayDuplicate /> : null}
        </After>
      )
    case 'unknown':
      return (
        <After>
          {status.line}
          {status.check !== undefined ? (
            <>
              {' '}
              <OpenButton target={status.check} actions={actions} label={copy.sendMessage.check} />
            </>
          ) : null}
          {status.mayDuplicate ? <MayDuplicate /> : null}
        </After>
      )
  }
}

function After({ children }: { readonly children: ReactNode }) {
  return (
    <Text variant="meta" tone="muted" as="p" sx={styles.after}>
      {children}
    </Text>
  )
}

/** "If the first try went through, this does it again." beside every retry of a non-deduplicated action. */
export function MayDuplicate() {
  return (
    <>
      {' '}
      <Text variant="meta" tone="muted" as="span">
        {chatCopy.card.mayDuplicate}
      </Text>
    </>
  )
}

/** "Open", or the target's own label, as a text button. */
export function OpenButton({ target, actions, label }: { readonly target: OpenTarget; readonly actions: ChatActions; readonly label?: string }) {
  const text = label ?? (target._tag === 'url' ? target.label : chatCopy.card.sendMessage.open)
  return <TextButton onClick={(event) => actions.onOpen(target, { metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: 'pointer' })}>{text}</TextButton>
}

/** The icon for a place or topic, by its tint and kind. */
export function placeIcon(tint: PlaceTint, kindLabel?: string): PhosphorIcon {
  switch (tint) {
    case 'private':
      return Lock
    case 'dm':
      return kindLabel === 'Group message' ? Users : User
    default:
      return Hash
  }
}

export const placeIconFor = (place: Place): PhosphorIcon => placeIcon(place.tint, place.kindLabel)

/**
 * A ghost button whose text is the danger red (Stop on a task, Remove on
 * a removal): the wrapper redefines the one variable the ghost button
 * reads, as `ListRow selected` does, so the primitive stays unchanged.
 */
export function DangerGhost({ children, onClick, disabled }: { readonly children: ReactNode; readonly onClick: () => void; readonly disabled?: boolean }) {
  return (
    <span {...stylex.props(styles.danger)}>
      <Button variant="ghost" size="md" onClick={onClick} dimmed={disabled} aria-disabled={disabled}>
        {children}
      </Button>
    </span>
  )
}

const appear = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  card: {
    width: '100%',
    maxWidth: chat['--card-max-width'],
    boxSizing: 'border-box',
  },
  // Laid out at full size and only fades in: the height never changes while entering.
  cardEnter: {
    width: '100%',
    maxWidth: chat['--card-max-width'],
    boxSizing: 'border-box',
    animationName: appear,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2-5'],
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-4'],
  },
  innerTight: {
    gap: spacing['--space-1'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2'],
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    minHeight: sizes['--control-22'],
    color: colors['--foreground-muted'],
    userSelect: 'none',
  },
  headerTight: {
    paddingInline: spacing['--space-2-5'],
  },
  dismiss: {
    display: 'inline-flex',
    marginInlineStart: 'auto',
    flexShrink: 0,
  },
  line: {
    textWrap: 'pretty',
    userSelect: 'none',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    minHeight: sizes['--control-30'],
    minWidth: 0,
  },
  buttons: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing['--space-1-5'],
    width: '100%',
    // The task card prints its after-line here: the slot keeps the buttons' height either way.
    minHeight: sizes['--control-30'],
    transitionProperty: 'opacity',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
  },
  // The click landed; nothing can be clicked again until the outcome arrives.
  working: {
    opacity: opacity['--opacity-disabled'],
    pointerEvents: 'none',
  },
  after: {
    textWrap: 'pretty',
    userSelect: 'none',
  },
  danger: {
    display: 'inline-flex',
    '--foreground-default': colors['--danger'],
  },
})
