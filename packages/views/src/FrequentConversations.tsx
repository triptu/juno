import * as stylex from '@stylexjs/stylex'
import type { PickConversation } from '@juno/contract'
import { layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { chunk, Text } from '@juno/ui'
import { Suspense } from 'react'

const frequent = chunk(() => import('./FrequentRows'))
export const loadFrequentRows = frequent.load
const FrequentRows = frequent.component((module) => module.default)

export interface FrequentConversationsProps {
  readonly conversations: ReadonlyArray<PickConversation>
  readonly selected: string | undefined
  readonly onPick: (conversation: PickConversation) => void
}

/** Standard list rows; every destination is a separate Tab stop. */
export function FrequentConversations({ conversations, selected, onPick }: FrequentConversationsProps) {
  return (
    <div data-frequent-block="" {...stylex.props(styles.block)}>
      <Text variant="sectionLabel" tone="muted" as="div" sx={styles.label}>Frequent</Text>
      <div role="list" aria-label="Frequent conversations">
        <Suspense fallback={<div data-chunk-pending="" aria-hidden="true">{conversations.map(conversation => <div key={conversation.key} {...stylex.props(styles.placeholder)} />)}</div>}>
          <FrequentRows conversations={conversations} selected={selected} onPick={onPick} />
        </Suspense>
      </div>
      <Text variant="meta" tone="muted" as="div" sx={styles.hint}>Write your message, then pick where it goes.</Text>
    </div>
  )
}

const styles = stylex.create({
  placeholder: { height: sizes['--control-32'] },
  block: {
    width: layout['--sidebar-width'],
    maxWidth: '100%',
  },
  label: {
    paddingInline: spacing['--space-3'],
    paddingBottom: spacing['--space-1'],
  },
  // As far below the last row's text as the label is above the first row's.
  hint: {
    paddingInline: spacing['--space-3'],
    paddingTop: spacing['--space-1'],
  },
})
