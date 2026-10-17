import * as stylex from '@stylexjs/stylex'
import type { SlackScheduleView } from '@juno/contract'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Section, Surface, Text } from '@juno/ui'

export interface SlackScheduleProps {
  /** Undefined until the engine answers. */
  readonly schedule: SlackScheduleView | undefined
  /** On also applies the notification hours once, which is Use Juno's hours. */
  readonly onChange: (enabled: boolean) => void
  /** Restore Slack's previous schedule. */
  readonly onRestore: () => void
}

/**
 * Settings › Notifications › Slack on your phone (SPEC 14, inventory 13): the
 * switch for Slack's own schedule, on by default. While the schedule was
 * changed in Slack, one line says so with Use Juno's hours. Restore shows
 * while Juno holds the schedule from before its first write.
 */
export function SlackScheduleSection({ schedule, onChange, onRestore }: SlackScheduleProps) {
  const enabled = schedule?.enabled ?? true
  return (
    <Section heading="Slack on your phone">
      <Surface kind="group" padding="md" sx={styles.card}>
        <Checkbox
          role="switch"
          label="Pause Slack outside your notification hours"
          checked={enabled}
          disabled={schedule === undefined}
          onChange={(event) => onChange(event.currentTarget.checked)}
          description="Juno sets Slack's own notification schedule to your notification hours, so your phone goes quiet too. Slack can't let a channel through, so Every message on a channel reaches only this Mac then."
        />
        {/* Always there, so Restore or the line going away moves nothing below. */}
        <div {...stylex.props(styles.actions)} aria-live="polite">
          {schedule?.changedInSlack === true ? (
            <>
              <Text variant="meta" tone="muted">
                Your schedule was changed in Slack. Juno leaves it until you change your hours here.
              </Text>
              <Button variant="secondary" size="sm" onClick={() => onChange(true)}>
                Use Juno's hours
              </Button>
            </>
          ) : null}
          {schedule?.canRestore === true ? (
            <Button variant="ghost" size="sm" tone="subtle" onClick={onRestore}>
              Restore Slack's previous schedule
            </Button>
          ) : null}
        </div>
      </Surface>
    </Section>
  )
}

const styles = stylex.create({
  card: {
    paddingInline: spacing['--space-3-5'],
  },
  // Indented to the switch's label, as Settings › General's Read status line is.
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minHeight: spacing['--space-8'],
    paddingInlineStart: `calc(${sizes['--checkbox']} + ${spacing['--space-2-5']})`,
  },
})
