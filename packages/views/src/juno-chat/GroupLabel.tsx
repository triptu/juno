import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import { chatCopy, type GroupLabelItem } from '@juno/agent-contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { TextButton } from './TextButton'

export interface GroupLabelProps {
  readonly item: GroupLabelItem
  readonly actions: ChatActions
}

/**
 * The 11px label over a proactive group ("Scheduled · Daily
 * catch-up", "T3 Code · 2 jobs") with "Why this?" and one quiet action by
 * origin: "Pause schedule" or "Mute updates". Neither stops a job.
 */
export const GroupLabel = memo(function GroupLabel({ item, actions }: GroupLabelProps) {
  const copy = chatCopy.groupLabel
  const quiet = item.origin._tag === 'schedule' ? ({ label: copy.pauseSchedule, action: 'pauseSchedule' } as const) : item.origin._tag === 'job' ? ({ label: copy.muteUpdates, action: 'muteUpdates' } as const) : undefined
  return (
    <div data-chat-group-label={item.id} {...stylex.props(styles.root)}>
      <Text variant="sectionLabel" tone="muted" truncate dir="auto" sx={styles.text}>
        {item.text}
      </Text>
      <Text variant="sectionLabel" tone="subtle" sx={styles.action}>
        <TextButton tone="muted" onClick={() => actions.onGroupLabel(item.id, 'why')}>
          {copy.why}
        </TextButton>
      </Text>
      {quiet ? (
        <Text variant="sectionLabel" tone="subtle" sx={styles.action}>
          <TextButton tone="muted" onClick={() => actions.onGroupLabel(item.id, quiet.action)}>
            {quiet.label}
          </TextButton>
        </Text>
      ) : null}
    </div>
  )
})

const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
    minWidth: 0,
    marginTop: spacing['--space-5'],
    marginBottom: `calc(${spacing['--space-1']} - ${spacing['--space-2']})`,
    paddingInlineStart: `calc(${spacing['--space-7']} + ${spacing['--space-2-5']})`,
    color: colors['--foreground-muted'],
    userSelect: 'none',
  },
  text: {
    minWidth: 0,
    flexShrink: 1,
  },
  action: {
    flexShrink: 0,
    textTransform: 'none',
  },
})
