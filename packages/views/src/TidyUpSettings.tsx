import * as stylex from '@stylexjs/stylex'
import type { TidyUpPrefs, TidyUpQuiet } from '@juno/contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Checkbox, Page, PageHeader, Section, Segmented, Surface, Text } from '@juno/ui'
import { settledCopy } from './SettledReview'

const quietOptions: ReadonlyArray<{ readonly value: TidyUpQuiet; readonly label: string }> = [
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: '1d', label: '1 day' },
  { value: '3d', label: '3 days' },
]

export interface SettingsTidyUpProps {
  readonly prefs: TidyUpPrefs
  readonly onChange: (prefs: TidyUpPrefs) => void
  /** Tidy up needs AI assist: off, the settings stay and say why nothing is suggested. */
  readonly aiAssist: boolean
}

/**
 * Settings › Tidy up (SPEC 14): what Resolve does, in the same words as the
 * review's info, then when Juno suggests a topic: how quiet it must be, and
 * which kinds. The rule that never suggests a topic waiting on you is
 * stated, not a switch.
 */
export function SettingsTidyUp({ prefs, onChange, aiAssist }: SettingsTidyUpProps) {
  return (
    <Page width="settings">
      <PageHeader title="Tidy up" subtitle="Juno suggests resolving topics that look finished, so the sidebar shows only what is still going on. Home lists them under Tidy up." />
      <Section heading={settledCopy.about}>
        <Surface kind="group" padding="md" sx={styles.card}>
          <ul {...stylex.props(styles.points)} data-tidy-explain="">
            {settledCopy.explain.map((line) => (
              <li key={line} {...stylex.props(styles.point)}>
                <Text variant="body" tone="subtle" as="span">
                  {line}
                </Text>
              </li>
            ))}
          </ul>
        </Surface>
      </Section>
      <Section heading="Suggestions" sub="Juno never suggests a topic where someone asked you something you have not answered, or where the last message mentions you.">
        <Surface kind="group" padding="md" sx={[styles.card, styles.rows]}>
          {aiAssist ? null : (
            <Text variant="meta" tone="muted" as="p" sx={styles.off} data-tidy-off="">
              Suggestions need AI assist. Turn it on in the avatar menu.
            </Text>
          )}
          <div {...stylex.props(styles.row)}>
            <Text variant="ui" tone="default" weight="medium">
              Suggest once a topic is quiet for
            </Text>
            <Segmented options={quietOptions} value={prefs.quiet} onChange={(quiet) => onChange({ ...prefs, quiet })} label="Suggest once a topic is quiet for" />
          </div>
          <div {...stylex.props(styles.row, styles.top)}>
            <Text variant="ui" tone="default" weight="medium">
              Suggest
            </Text>
            <span {...stylex.props(styles.checks)}>
              <Checkbox label="Threads" checked={prefs.threads} onChange={(event) => onChange({ ...prefs, threads: event.currentTarget.checked })} />
              <Checkbox label="Direct messages" checked={prefs.dms} onChange={(event) => onChange({ ...prefs, dms: event.currentTarget.checked })} />
            </span>
          </div>
        </Surface>
      </Section>
    </Page>
  )
}

const styles = stylex.create({
  // The same 14px inset as the other Settings cards.
  card: {
    paddingInline: spacing['--space-3-5'],
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3-5'],
  },
  // As TabExpirySetting: the label at the start, the control at the trailing edge, wrapping under on a narrow page.
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: spacing['--space-6'],
    rowGap: spacing['--space-2'],
    minHeight: spacing['--space-8'],
  },
  top: {
    alignItems: 'flex-start',
  },
  checks: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  off: {
    margin: 0,
  },
  points: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    margin: 0,
    paddingInlineStart: spacing['--space-4'],
  },
  point: {
    color: colors['--foreground-muted'],
  },
})
