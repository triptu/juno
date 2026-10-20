import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Checkbox, Section, Surface } from '@juno/ui'

export interface HuddleRingProps {
  /** On by default. */
  readonly huddleRing: boolean
  readonly onHuddleRingChange: (enabled: boolean) => void
}

/**
 * Settings › Notifications › Huddles (SPEC 20, "Incoming huddles"; inventory
 * 13): Ring for huddles. Off, an incoming huddle shows its card and
 * notification without the ring.
 */
export function HuddleRingSection({ huddleRing, onHuddleRingChange }: HuddleRingProps) {
  return (
    <Section heading="Huddles">
      <Surface kind="group" padding="md" sx={styles.card}>
        <Checkbox
          role="switch"
          label="Ring for huddles"
          checked={huddleRing}
          onChange={(event) => onHuddleRingChange(event.currentTarget.checked)}
          description="A soft ring for up to 30 seconds when someone starts a huddle. It plays even during Focus."
        />
      </Surface>
    </Section>
  )
}

const styles = stylex.create({
  // As Slack on your phone's card, so the switch starts on the rows' line.
  card: {
    paddingInline: spacing['--space-3-5'],
  },
})
