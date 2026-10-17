import * as stylex from '@stylexjs/stylex'
import { memo, type ReactNode } from 'react'
import { chatCopy, type AskItem, type ProactiveAsk } from '@juno/agent-contract'
import { chat, motion, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Surface, Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { rowStyles } from './rows'
import { TextButton } from './TextButton'

export interface AskCardProps {
  readonly ask: ProactiveAsk
  readonly actions: ChatActions
  /** Play the fade on mount. False for an ask drawn settled (the gallery). */
  readonly enter?: boolean
}

const copy = chatCopy.ask.learn

/** The ask's title: "Let Juno learn how you work", or "Let Juno learn from Littlebird". */
const askTitle = (ask: ProactiveAsk): string => (ask.reason === 'connection' ? copy.title.connection(ask.connection ?? '') : copy.title.setup)

/**
 * A proactive ask in the chat (SPEC 13.6, 13.8): what Juno offers to do and
 * what it reads, with Not now and Start. Once started, the footer holds the
 * pass's live line and Stop; once it ends, what it kept with Open, or why it
 * stopped with Try again. The footer keeps its height through every state,
 * so nothing under the card moves. It looks like a card, but it is Juno's
 * own code that offers it, never the model.
 */
export const AskCard = memo(function AskCard({ ask, actions, enter = true }: AskCardProps) {
  const status = ask.status
  const body = ask.reason === 'connection' ? copy.bodyConnection(ask.connection ?? '') : copy.body(ask.sources)
  return (
    <Surface kind="card" as="article" padding="none" data-chat-ask={ask.kind} data-ask-status={status._tag} aria-busy={status._tag === 'running' || undefined} sx={enter ? styles.cardEnter : styles.card}>
      <div {...stylex.props(styles.inner)}>
        <Text variant="meta" weight="medium" tone="subtle">
          {chatCopy.ask.label}
        </Text>
        <Text variant="bodySmall" weight="medium" tone="default" as="h3">
          {askTitle(ask)}
        </Text>
        <Text variant="bodySmall" tone="muted" as="p" sx={styles.body}>
          {body}
        </Text>
        <div {...stylex.props(styles.footer)}>
          <Footer ask={ask} actions={actions} />
        </div>
      </div>
    </Surface>
  )
})

function Footer({ ask, actions }: { readonly ask: ProactiveAsk; readonly actions: ChatActions }): ReactNode {
  const status = ask.status
  const answer = (choice: 'start' | 'dismiss' | 'stop') => actions.onAsk(ask.id, choice)
  const open = <TextButton onClick={(event) => actions.onOpen({ _tag: 'page', page: 'remembers' }, { metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: 'pointer' })}>{copy.open}</TextButton>
  switch (status._tag) {
    case 'open':
      return (
        <div {...stylex.props(styles.buttons)}>
          <Button variant="ghost" size="md" tone="subtle" onClick={() => answer('dismiss')}>
            {copy.notNow}
          </Button>
          <Button variant="secondary" size="md" onClick={() => answer('start')}>
            {copy.start}
          </Button>
        </div>
      )
    case 'running':
      return (
        <div {...stylex.props(styles.running)}>
          <Text variant="meta" tone="muted" truncate data-ask-line="">
            {status.line}
          </Text>
          <Button variant="ghost" size="md" tone="subtle" onClick={() => answer('stop')}>
            {copy.stop}
          </Button>
        </div>
      )
    case 'done':
      return (
        <After>
          {copy.done(status.written)} · {open}
        </After>
      )
    case 'failed':
      return (
        <After>
          {copy.failed[status.reason]}
          {copy.kept(status.written)} · <TextButton onClick={() => answer('start')}>{copy.tryAgain}</TextButton>
        </After>
      )
    case 'stopped':
      return (
        <After>
          {copy.stopped[status.reason]}
          {copy.kept(status.written)} · <TextButton onClick={() => answer('start')}>{copy.tryAgain}</TextButton>
        </After>
      )
    case 'dismissed':
      return <After>{copy.dismissed}</After>
  }
}

function After({ children }: { readonly children: ReactNode }) {
  return (
    <Text variant="meta" tone="muted" as="p" data-ask-after="" sx={styles.after}>
      {children}
    </Text>
  )
}

export interface AskRowProps {
  readonly item: AskItem
  readonly actions: ChatActions
}

/** The ask in its own row of the chat, lined up under the bubbles as a card is. */
export const AskRow = memo(function AskRow({ item, actions }: AskRowProps) {
  return (
    <div data-chat-ask-row={item.ask.id} {...stylex.props(rowStyles.row, styles.row)}>
      <div {...stylex.props(rowStyles.anchor, styles.cell)}>
        <AskCard ask={item.ask} actions={actions} />
      </div>
    </div>
  )
})

const appear = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  row: {
    alignItems: 'flex-start',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: spacing['--space-2'],
  },
  cell: {
    display: 'flex',
    flexGrow: 1,
    minWidth: 0,
  },
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
    gap: spacing['--space-1-5'],
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-4'],
  },
  body: {
    textWrap: 'pretty',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    minHeight: sizes['--control-30'],
    minWidth: 0,
    marginTop: spacing['--space-1'],
  },
  buttons: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing['--space-1-5'],
    width: '100%',
  },
  running: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
    width: '100%',
    minWidth: 0,
  },
  after: {
    textWrap: 'pretty',
    userSelect: 'none',
  },
})
