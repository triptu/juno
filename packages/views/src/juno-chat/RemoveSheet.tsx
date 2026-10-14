import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { chatCopy, type RemoveSheet as RemoveSheetModel } from '@juno/agent-contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Surface, Text } from '@juno/ui'
import { RemoveRows } from './cards'
import { DangerGhost } from './cards/ChatCard'

export interface RemoveSheetProps {
  readonly sheet: RemoveSheetModel
  readonly now: number
  readonly onRemove: (alsoReply: boolean) => void
  readonly onKeep: () => void
}

/**
 * The local Remove sheet (SPEC 13.8), opened from a message's context
 * menu. It needs no run, so it works paused, offline, in recovery and with
 * AI off. The container places it in a modal layer; this is the panel.
 */
export function RemoveSheet({ sheet, now, onRemove, onKeep }: RemoveSheetProps) {
  const [alsoReply, setAlsoReply] = useState(false)
  const copy = chatCopy.removeSheet
  return (
    <Surface kind="popover" as="section" role="dialog" aria-label={copy.title} aria-modal data-remove-sheet="" padding="none" sx={styles.sheet}>
      <div {...stylex.props(styles.inner)}>
        <Text variant="heading" tone="default" as="h2">
          {copy.title}
        </Text>
        <Text variant="bodySmall" tone="subtle" as="p">
          {copy.body}
        </Text>
        <RemoveRows messages={sheet.messages} now={now} />
        {sheet.offerReply !== undefined ? <Checkbox label={copy.alsoReply} checked={alsoReply} onChange={(event) => setAlsoReply(event.currentTarget.checked)} /> : null}
        <Text variant="meta" tone="muted" as="p">
          {copy.cannotRecall}
        </Text>
        <div {...stylex.props(styles.buttons)}>
          <Button variant="secondary" size="md" onClick={onKeep} autoFocus>
            {copy.keep}
          </Button>
          <DangerGhost onClick={() => onRemove(alsoReply)}>{copy.remove}</DangerGhost>
        </div>
      </div>
    </Surface>
  )
}

const styles = stylex.create({
  sheet: {
    width: '100%',
    maxWidth: layout['--palette-width'],
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-5'],
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing['--space-1-5'],
    paddingTop: spacing['--space-1'],
  },
})
