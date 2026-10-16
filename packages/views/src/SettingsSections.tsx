import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { IgnoredChannel, SendCheckPref } from '@juno/contract'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Page, PageHeader, Section, Surface, Text } from '@juno/ui'
import { AppearanceSettings, type AppearanceSettingsProps } from './AppearanceSettings'
import { IgnoredChannels } from './IgnoredChannels'
import { QuietWindowSetting } from './QuietWindowSetting'
import { NewTabSetting, type NewTabPageName } from './NewTabSetting'
import { PeekKeySetting, type PeekKeyName } from './PeekKeySetting'

// The sections of Settings that are the app's own (SPEC 14). Notifications,
// Juno, Connections and Backup & This Mac are their own pages. Each section
// is a settings page with its title; `SettingsPage` puts the list beside it.

const checkLabels: Record<SendCheckPref, string> = {
  wrongPlace: 'Wrong place', typos: 'Typos and doubled words', capitalI: 'Capital i',
  questionMarks: 'Question marks', longSentences: 'Long sentences', grammar: 'Grammar (uses AI)',
}

export interface SettingsGeneralProps {
  /** How many days of activity the sidebar shows (1, 3, 7 or 14). */
  readonly quietDays: number
  readonly onQuietDaysChange: (days: number) => void
  readonly checks: ReadonlyArray<{ readonly key: SendCheckPref; readonly enabled: boolean }>
  readonly grammarUnavailable?: string | undefined
  readonly onCheckChange: (key: SendCheckPref, enabled: boolean) => void
  /** What a new tab opens: "+", ⌘T and the tab that replaces the last one closed. */
  readonly newTabPage: NewTabPageName
  readonly onNewTabPageChange: (page: NewTabPageName) => void
  readonly peekKey: PeekKeyName
  readonly onPeekKeyChange: (key: PeekKeyName) => void
  readonly mirrorReads: boolean
  readonly onMirrorReadsChange: (enabled: boolean) => void
  /** Earlier reads still to send to Slack (`reads.catchUpStatus`); undefined until it arrives. */
  readonly catchUp: { readonly available: number; readonly pending: number } | undefined
  readonly onCatchUp: () => void
  readonly classifier: boolean
  readonly onClassifierChange: (enabled: boolean) => void
}

/** General: topic recency, tabs, peek, Slack read mirroring, message checks and the fast classifier. */
export function SettingsGeneral({ quietDays, onQuietDaysChange, newTabPage, onNewTabPageChange, peekKey, onPeekKeyChange, classifier, onClassifierChange, mirrorReads, onMirrorReadsChange, catchUp, onCatchUp, checks, grammarUnavailable, onCheckChange }: SettingsGeneralProps) {
  return (
    <Page width="settings">
      <PageHeader title="General" />
      <Section heading="Topics" sub="Pinned and unread topics, and topics open in a tab, always show.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <QuietWindowSetting value={quietDays} onChange={onQuietDaysChange} />
        </Surface>
      </Section>
      <Section heading="Tabs" sub="What the + button, ⌘T and closing the last tab open.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <NewTabSetting value={newTabPage} onChange={onNewTabPageChange} />
        </Surface>
      </Section>
      <Section heading="Peek" sub="Hold the key over a topic in the sidebar to read it without marking it read.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <PeekKeySetting value={peekKey} onChange={onPeekKeyChange} />
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

/** Appearance: theme, accent and density, and nothing else. */
export function SettingsAppearance(props: AppearanceSettingsProps) {
  return (
    <Page width="settings">
      <PageHeader title="Appearance" subtitle="System follows macOS. Density changes the sidebar and the messages." />
      <Surface kind="group" padding="md" sx={styles.card}>
        <AppearanceSettings {...props} />
      </Surface>
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
      <PageHeader title="Ignored" subtitle="Ignored channels are hidden from your topics, search and All topics, and they never notify you. Nothing changes in Slack." />
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
  /** The engine's status line and Ping engine. */
  readonly diagnostics: ReactNode
}

/** About: the version, updates, and the diagnostics for when something looks wrong. */
export function SettingsAbout({ build, updates, diagnostics }: SettingsAboutProps) {
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
      <Section heading="Diagnostics" sub="What the sync engine is doing. Useful when something looks wrong.">
        <Surface kind="group" padding="md" sx={styles.card}>{diagnostics}</Surface>
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
})
