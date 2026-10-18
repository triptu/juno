import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { IgnoredChannel, SendCheckPref } from '@juno/contract'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Page, PageHeader, Section, Surface, Text } from '@juno/ui'
import { AppearanceSettings, type AppearanceSettingsProps } from './AppearanceSettings'
import { IgnoredChannels } from './IgnoredChannels'
import { PeekKeySetting, type PeekKeyName } from './PeekKeySetting'

// The sections of Settings that are the app's own (SPEC 14). Notifications,
// Juno, Connections and Backup & This Mac are their own pages. Each section
// is a settings page with its title; `SettingsPage` puts the list beside it.

export type SharingDetection = 'available' | 'missing' | 'alwaysOn'

const SHARING_LINE: Record<SharingDetection, string> = {
  available: 'When another app starts recording or sharing the screen, Juno hides message text as ⌃⌘H does, and shows it again when that stops.',
  missing: 'This Mac does not tell Juno when the screen is shared. Use ⌃⌘H to hide message text.',
  alwaysOn: "Another app is recording the screen all the time, so Juno can't tell when you share. Use ⌃⌘H to hide message text.",
}

const checkLabels: Record<SendCheckPref, string> = {
  wrongPlace: 'Wrong place', typos: 'Typos and doubled words', capitalI: 'Capital i',
  questionMarks: 'Question marks', longSentences: 'Long sentences', grammar: 'Grammar (uses AI)',
}

export interface SettingsGeneralProps {
  readonly checks: ReadonlyArray<{ readonly key: SendCheckPref; readonly enabled: boolean }>
  readonly grammarUnavailable?: string | undefined
  readonly onCheckChange: (key: SendCheckPref, enabled: boolean) => void
  readonly peekKey: PeekKeyName
  readonly onPeekKeyChange: (key: PeekKeyName) => void
  /** A plain click on a web link opens it in the web panel (SPEC 7). */
  readonly webPanel: boolean
  readonly onWebPanelChange: (enabled: boolean) => void
  /** A quote or fact under Home's greeting when nothing waits (SPEC 12). */
  readonly homeThoughts: boolean
  readonly onHomeThoughtsChange: (enabled: boolean) => void
  readonly mirrorReads: boolean
  readonly onMirrorReadsChange: (enabled: boolean) => void
  /** Earlier reads still to send to Slack (`reads.catchUpStatus`); undefined until it arrives. */
  readonly catchUp: { readonly available: number; readonly pending: number } | undefined
  readonly onCatchUp: () => void
  readonly classifier: boolean
  readonly onClassifierChange: (enabled: boolean) => void
  /** Privacy mode turns on while the screen is shared (SPEC section 5). */
  readonly hideWhileSharing: boolean
  /**
   * Whether Juno can tell that the screen is shared. `missing`: macOS does not say, so the switch
   * is off and disabled. `alwaysOn`: another app captures the screen all the time, so a line says so.
   */
  readonly sharingDetection: SharingDetection
  readonly onHideWhileSharingChange: (enabled: boolean) => void
}

/** General: peek, Home's thought, links, Slack read mirroring, hiding text while sharing, message checks and the fast classifier. */
export function SettingsGeneral({ peekKey, onPeekKeyChange, homeThoughts, onHomeThoughtsChange, webPanel, onWebPanelChange, classifier, onClassifierChange, mirrorReads, onMirrorReadsChange, catchUp, onCatchUp, checks, grammarUnavailable, onCheckChange, hideWhileSharing, sharingDetection, onHideWhileSharingChange }: SettingsGeneralProps) {
  return (
    <Page width="settings">
      <PageHeader title="General" />
      <Section heading="Peek" sub="Hold the key over a topic in the sidebar to read it without marking it read.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <PeekKeySetting value={peekKey} onChange={onPeekKeyChange} />
        </Surface>
      </Section>
      <Section heading="Home">
        <Surface kind="group" padding="md" sx={styles.card}>
          <Checkbox role="switch" label="Show a thought when Home is empty" checked={homeThoughts}
            onChange={(event) => onHomeThoughtsChange(event.currentTarget.checked)}
            description="A short quote or fact under the greeting when nothing is waiting." />
        </Surface>
      </Section>
      <Section heading="Links">
        <Surface kind="group" padding="md" sx={styles.card}>
          <Checkbox role="switch" label="Open links in Juno" checked={webPanel}
            onChange={(event) => onWebPanelChange(event.currentTarget.checked)}
            description="A web link opens in a panel beside the topic. Off, links open in your browser." />
        </Surface>
      </Section>
      <Section heading="Read status">
        <Surface kind="group" padding="md" sx={styles.card}>
          <Checkbox role="switch" label="Mark messages read in Slack too" checked={mirrorReads}
            onChange={(event) => onMirrorReadsChange(event.currentTarget.checked)}
            description="When you read something in Juno, Slack shows it as read too, on all your devices. Peeking never marks anything read." />
          <div {...stylex.props(styles.catchUp)} aria-live="polite">
            {!mirrorReads || catchUp === undefined ? null
              : catchUp.pending > 0 ? <Text variant="meta" tone="muted">Marking earlier reads in Slack · {catchUp.pending} remaining</Text>
              : catchUp.available > 0 ? <Button variant="secondary" size="sm" onClick={onCatchUp}>Mark earlier reads in Slack</Button>
              : <Text variant="meta" tone="muted">Earlier reads are in Slack</Text>}
          </div>
        </Surface>
      </Section>
      <Section heading="Screen sharing">
        <Surface kind="group" padding="md" sx={styles.card}>
          <Checkbox role="switch" label="Hide message text while sharing the screen" checked={sharingDetection !== 'missing' && hideWhileSharing} disabled={sharingDetection === 'missing'}
            onChange={(event) => onHideWhileSharingChange(event.currentTarget.checked)}
            description={SHARING_LINE[sharingDetection]} />
        </Surface>
      </Section>
      <Section heading="Message checks" sub="Wrong place checks before sending. Other checks suggest small fixes after you send. You review and save every edit.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <div {...stylex.props(styles.stack)}>
            {checks.map(({ key, enabled }) => <Checkbox key={key} label={checkLabels[key]} checked={enabled && !(key === 'grammar' && grammarUnavailable)} disabled={key === 'grammar' && grammarUnavailable !== undefined} onChange={(event) => onCheckChange(key, event.currentTarget.checked)} />)}
            {grammarUnavailable && <Text variant="meta" tone="muted" as="p">{grammarUnavailable}</Text>}
          </div>
        </Surface>
      </Section>
      <Section heading="AI assist" sub="A fast model decides which messages notify you, when a message may be in the wrong place and when a topic looks settled. Off, a slower chat model decides.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <Checkbox label="Use fast classifier" checked={classifier} onChange={(event) => onClassifierChange(event.currentTarget.checked)} />
        </Surface>
      </Section>
    </Page>
  )
}

export interface SettingsAppearanceProps extends AppearanceSettingsProps {
  /** The quick reactions setting (`QuickReactionsSetting`), in its own section under the look. */
  readonly quickReactions?: ReactNode
}

/** Appearance: theme, accent and density, then the message toolbar's quick reactions. */
export function SettingsAppearance({ quickReactions, ...props }: SettingsAppearanceProps) {
  return (
    <Page width="settings">
      <PageHeader title="Appearance" subtitle="System follows macOS. Density changes the sidebar and the messages." />
      <Surface kind="group" padding="md" sx={styles.card}>
        <AppearanceSettings {...props} />
      </Surface>
      {quickReactions === undefined ? null : (
        <Section heading="Quick reactions" sub="One click each in the toolbar over a message. Up to 7.">
          <Surface kind="group" padding="md" sx={styles.card}>
            {quickReactions}
          </Surface>
        </Section>
      )}
    </Page>
  )
}

export interface SettingsIgnoredProps {
  /** The ignore list; undefined until it arrives. */
  readonly ignored: ReadonlyArray<IgnoredChannel> | undefined
  readonly onStopIgnoring: (channel: IgnoredChannel) => void
}

/** Ignored: the channels hidden everywhere in Juno. */
export function SettingsIgnored({ ignored, onStopIgnoring }: SettingsIgnoredProps) {
  return (
    <Page width="settings">
      <PageHeader title="Ignored" subtitle="Ignored channels are hidden from your topics, search and All topics. They notify you only when someone mentions you or a group you are in. Nothing changes in Slack." />
      <Section heading="Channels">
        <Surface kind="group" padding="md" sx={styles.card}>
          <IgnoredChannels channels={ignored} onStopIgnoring={onStopIgnoring} />
        </Surface>
        <Text variant="meta" tone="muted" as="p">
          Right-click a channel to ignore it.
        </Text>
      </Section>
    </Page>
  )
}

export interface SettingsAboutProps {
  /** The build line: "Juno 0.1.0 on darwin, Electron 44.7.0". */
  readonly build: ReactNode
  /** The update setting (`UpdateSettings`). */
  readonly updates: ReactNode
  /** The engine's status line and Ping engine, then each process's CPU and memory and Copy diagnostics. */
  readonly diagnostics: ReactNode
  /** Brings the welcome card back on Home (SPEC 4, "The welcome"). */
  readonly onShowTour: () => void
}

/** About: the version, updates, the tour, and the diagnostics for when something looks wrong. */
export function SettingsAbout({ build, updates, diagnostics, onShowTour }: SettingsAboutProps) {
  return (
    <Page width="settings">
      <PageHeader title="About" />
      <Section heading="Version">
        <Surface kind="group" padding="md" sx={styles.card}>
          <div {...stylex.props(styles.stack)}>
            {build}
            {updates}
          </div>
        </Surface>
      </Section>
      <Section heading="Tour">
        <Surface kind="group" padding="md" sx={styles.card}>
          <div {...stylex.props(styles.tour)}>
            <Text variant="body">Three things to try, back on Home.</Text>
            <Button variant="secondary" size="sm" onClick={onShowTour}>
              Show the tour
            </Button>
          </div>
        </Surface>
      </Section>
      <Section heading="Diagnostics" sub="What Juno's processes are doing. Useful when something looks wrong.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <div {...stylex.props(styles.diagnostics)}>{diagnostics}</div>
        </Surface>
      </Section>
    </Page>
  )
}

const styles = stylex.create({
  // 14px in, so labels start 15px from the card's edge with its 1px border,
  // on the same line as the rows of Notifications, Juno, Connections and Backup.
  card: {
    paddingInline: spacing['--space-3-5'],
  },
  // Starts on the switch label's text: past the 15px box and the Checkbox's 10px gap.
  catchUp: {
    minHeight: spacing['--space-8'],
    paddingInlineStart: `calc(${sizes['--checkbox']} + ${spacing['--space-2-5']})`,
    display: 'flex',
    alignItems: 'center',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
  },
  // The engine line over the processes table, which takes the card's width.
  diagnostics: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-4'],
  },
  tour: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing['--space-3'],
  },
})
