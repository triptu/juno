import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import { chatCopy, type EndingItem, type OpId } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { rowStyles } from './rows'
import { TextButton } from './TextButton'

/**
 * The fixed line of a run that did not end `complete` (SPEC 13.7), in its
 * own row under the run's last bubble or card. Try again resends the
 * owner's message when the ending carries it.
 */
export const EndingLine = memo(function EndingLine({ item, actions }: { readonly item: EndingItem; readonly actions: ChatActions }) {
  const copy = chatCopy.ending
  const ending = item.ending
  const retry = (opId: OpId | undefined) =>
    opId === undefined ? null : (
      <>
        {' '}
        <TextButton onClick={() => actions.onRetry(opId)}>{copy.tryAgain}</TextButton>
      </>
    )
  const line =
    ending._tag === 'complete' ? null
    : ending._tag === 'interrupted' ? <>{copy.interrupted}{retry(ending.retry)}</>
    : ending._tag === 'blocked' ? copy.blocked[ending.reason]
    : <>{copy.failed[ending.reason]}{retry(ending.retry)}</>
  if (line === null) return null
  return (
    <div data-chat-ending={item.runId} {...stylex.props(rowStyles.lineSlot, styles.slot)}>
      <Text variant="meta" tone="muted" data-ending={ending._tag} sx={rowStyles.lineText}>
        {line}
      </Text>
    </div>
  )
})

const styles = stylex.create({
  // The bubble's 2px in from the column's edge.
  slot: {
    paddingInlineStart: spacing['--space-0-5'],
  },
})
