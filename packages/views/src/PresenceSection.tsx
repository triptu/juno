import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Checkbox, Section, Surface } from '@juno/ui'

export interface PresenceProps {
  /** On by default. */
  readonly showPresence: boolean
  readonly onShowPresenceChange: (enabled: boolean) => void
}

/**
 * Settings › Notifications › Presence (SPEC 14, "Show when people are
 * active"): a green dot on a DM partner's photo in the sidebar while Slack
 * shows them active. Off, Juno stops asking Slack. Your own dot stays.
 */
export function PresenceSection({ showPresence, onShowPresenceChange }: PresenceProps) {
  return (
    <Section heading="Presence">
      <Surface kind="group" padding="md" sx={styles.card}>
        <Checkbox
          role="switch"
          label="Show when people are active"
          checked={showPresence}
          onChange={(event) => onShowPresenceChange(event.currentTarget.checked)}
          description="A green dot on a person's photo in your DMs while Slack shows them active."
        />
      </Surface>
    </Section>
  )
}

const styles = stylex.create({
  // As the Huddles card, so the switch starts on the rows' line.
  card: {
    paddingInline: spacing['--space-3-5'],
  },
})
