import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Checkbox, Section, Surface } from '@juno/ui'

export interface PresenceProps {
  /** Off by default. */
  readonly showPresence: boolean
  readonly onShowPresenceChange: (enabled: boolean) => void
}

/**
 * Settings › Appearance › Sidebar (SPEC 14, "Show who is active in the
 * sidebar"): a green dot on a DM's photo in the sidebar while Slack shows
 * the person active. Off, Juno asks Slack only about the open DMs, whose
 * header always shows presence. Your own dot stays.
 */
export function PresenceSection({ showPresence, onShowPresenceChange }: PresenceProps) {
  return (
    <Section heading="Sidebar">
      <Surface kind="group" padding="md" sx={styles.card}>
        <Checkbox
          role="switch"
          label="Show who is active in the sidebar"
          checked={showPresence}
          onChange={(event) => onShowPresenceChange(event.currentTarget.checked)}
          description="A green dot on a DM's photo while Slack shows the person active. An open DM always shows whether they are active or away."
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
