import * as stylex from '@stylexjs/stylex'
import { ArrowBendUpLeft } from '@phosphor-icons/react/dist/icons/ArrowBendUpLeft'
import { Smiley } from '@phosphor-icons/react/dist/icons/Smiley'
import { chatCopy } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { IconButton } from '@juno/ui'
import type { ChatActions, ReactionTarget } from './commands'

/**
 * React and Reply beside a Juno bubble or card (SPEC 13.1). Their space is
 * always there and only opacity changes on hover or keyboard focus in the
 * row, so they never move the bubble.
 */
export function RowActions({ target, actions }: { readonly target: ReactionTarget; readonly actions: ChatActions }) {
  return (
    <span data-row-actions="" {...stylex.props(styles.actions)}>
      <IconButton icon={Smiley} label={chatCopy.react.react} size={26} tone="muted" onClick={(event) => actions.onReactions(target, event)} />
      <IconButton icon={ArrowBendUpLeft} label={chatCopy.react.reply} size={26} tone="muted" onClick={() => actions.onReply(target)} />
    </span>
  )
}

const styles = stylex.create({
  actions: {
    display: 'inline-flex',
    flexShrink: 0,
    alignSelf: 'center',
    gap: spacing['--space-0-5'],
    opacity: 'var(--row-action-opacity)',
  },
})
