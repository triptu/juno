import * as stylex from '@stylexjs/stylex'
import { accent, colors, spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene, Text } from '@juno/ui'
import { noopActions } from './commands'
import { NOW, owner } from './fixtures/data'
import { OwnerBubble, type OwnerBubbleProps } from './OwnerBubble'

const MINUTE = 60_000
const at = NOW - 4 * MINUTE

const bubble = (overrides: Partial<Parameters<typeof owner>> = []) => fixture<OwnerBubbleProps>({ item: owner('m-1', overrides[1] ?? 'What did I miss in #eng this morning?', overrides[2] ?? 'single', overrides[3] ?? { _tag: 'sent' }, at), now: NOW, actions: noopActions })

/**
 * The four colour options from docs/design/juno-chat/README.md, each
 * through the same component: the wrapper sets the two `chat` variables
 * the bubble reads, which is the one-line change switching an option is.
 */
const options = stylex.create({
  a: { '--owner-bubble-bg': accent['--hl'], '--owner-bubble-fg': accent['--hl-fg'] },
  b: { '--owner-bubble-bg': accent['--hl-bubble'], '--owner-bubble-fg': colors['--foreground-default'] },
  c: { '--owner-bubble-bg': colors['--secondary-default'], '--owner-bubble-fg': colors['--foreground-default'] },
  d: { '--owner-bubble-bg': colors['--accent-default'], '--owner-bubble-fg': colors['--accent-foreground'] },
})

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: spacing['--space-5'],
    width: '100%',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
})

const labels = { a: 'A · accent fill', b: 'B · accent tint (built)', c: 'C · neutral tint', d: 'D · ink' } as const

function Compare() {
  return (
    <div {...stylex.props(styles.grid)}>
      {(['a', 'b', 'c', 'd'] as const).map((option) => (
        <div key={option} data-owner-option={option} {...stylex.props(styles.column, options[option])}>
          <Text variant="sectionLabel" tone="muted">
            {labels[option]}
          </Text>
          <OwnerBubble item={owner(`m-${option}-1`, 'What did I miss in #eng this morning?', 'first', { _tag: 'sent' }, at)} now={NOW} actions={noopActions} />
          <OwnerBubble item={owner(`m-${option}-2`, 'And remind me when the offsite is', 'last', { _tag: 'sent' }, at)} now={NOW} actions={noopActions} />
          <OwnerBubble item={owner(`m-${option}-3`, 'Start a session to fix the flake, then tidy up anything settled in #eng', 'single', { _tag: 'queued', since: at }, at)} now={NOW} actions={noopActions} />
        </div>
      ))}
    </div>
  )
}

export default defineFixtures(
  OwnerBubble,
  {
    Colour: {
      'option-b': bubble(),
      'compare-a-to-d': scene(() => <Compare />, { width: 1100, padded: true }),
    },
    Group: {
      single: bubble(),
      first: bubble([undefined, undefined, 'first']),
      middle: bubble([undefined, undefined, 'middle']),
      last: bubble([undefined, undefined, 'last']),
    },
    Delivery: {
      sent: bubble(),
      queued: bubble([undefined, undefined, undefined, { _tag: 'queued', since: at }]),
      'waiting-network': bubble([undefined, undefined, undefined, { _tag: 'waiting', for: 'network' }]),
      'waiting-resume': bubble([undefined, undefined, undefined, { _tag: 'waiting', for: 'resume' }]),
      'waiting-review': bubble([undefined, undefined, undefined, { _tag: 'waiting', for: 'review' }]),
      'not-delivered': bubble([undefined, undefined, undefined, { _tag: 'failed', reason: 'notDelivered' }]),
      'too-long': bubble([undefined, undefined, undefined, { _tag: 'failed', reason: 'tooLong' }]),
    },
    Content: {
      'long-text': bubble([undefined, 'Can you give me the long version of what happened in #eng this week? I want every thread, who asked for what, what is blocked and what is just waiting, and anything I promised someone and have not done.']),
      'right-to-left': bubble([undefined, 'מה פספסתי ב-#eng הבוקר? ותזכיר לי מתי היום של הצוות']),
      'multi-line': bubble([undefined, 'Three things:\n1. the plan\n2. the flake\n3. the offsite']),
    },
    Interaction: {
      hover: { ...bubble(), frame: { width: 640, padded: true, hover: '[data-chat-owner] p' } },
    },
  },
  { width: 640, padded: true },
)
