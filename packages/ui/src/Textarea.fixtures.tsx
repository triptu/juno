import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { IconButton } from './IconButton'
import { Surface } from './Surface'
import { Textarea } from './Textarea'

/**
 * The composer composition: a field Surface with the attach and send
 * buttons beside an inline Textarea. The buttons sit at the end of the row
 * with a bottom margin that centres them on the last line of text, so they
 * line up with a single line and with the last line once it has grown.
 */
function Composer({ value, dimmed }: { readonly value?: string; readonly dimmed?: boolean }) {
  return (
    <Surface kind="field" sx={styles.composer}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.button)}>
          <IconButton icon={Plus} label="Attach" size={28} radius="full" iconSize={20} />
        </span>
        <Textarea variant="inline" placeholder="Reply" label="Reply" defaultValue={value} />
        <span {...stylex.props(styles.button)}>
          <IconButton icon={ArrowUp} label="Send" size={28} radius="full" variant="primary" iconWeight="bold" dimmed={dimmed} />
        </span>
      </div>
    </Surface>
  )
}

export default defineFixtures(
  Textarea,
  {
    Card: {
      card: fixture({ variant: 'card', defaultValue: 'The Wednesday slot works for eng.', label: 'Message' }),
    },
    Field: {
      field: fixture({ variant: 'field', defaultValue: 'Works from Lisbon, usually 9:30 to 18:00.', label: 'Note' }),
      'field-long': fixture({
        variant: 'field',
        defaultValue: 'Maya Chen: owns the Postgres 16 migration plan and the cutover runbook; reviews backfill PRs the same day.\nPrefers a short summary of the risk at the top.',
        label: 'Note',
      }),
      'field-focused': fixture({ variant: 'field', defaultValue: 'Works from Lisbon, usually 9:30 to 18:00.', label: 'Note' }, { width: 360, focus: 'textarea' }),
    },
    Composer: {
      composer: scene(() => <Composer dimmed />),
      'composer-grown': scene(() => (
        <Composer value={'Thursday works. I will pair.\n\n> What is the rollback if replication lags on cutover day?\n\nWe keep the old primary warm for 48h.'} />
      )),
      'composer-focused': scene(() => <Composer dimmed />, { focus: 'textarea' }),
    },
    Availability: {
      'card-disabled': fixture({ variant: 'card', defaultValue: 'Kicking off the Q1 planning cycle.', label: 'Message', disabled: true }),
    },
  },
  { width: 560 },
)

const styles = stylex.create({
  composer: { width: '100%' },
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: spacing['--space-1'],
    padding: spacing['--space-1-5'],
  },
  // (40px single line − 28px button) / 2, so the button centre meets the
  // centre of the text line it sits beside.
  button: {
    display: 'inline-flex',
    flexShrink: 0,
    marginBottom: `calc((${sizes['--control-40']} - ${sizes['--control-28']}) / 2)`,
  },
})
