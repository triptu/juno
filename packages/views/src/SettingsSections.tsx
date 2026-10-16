import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { IgnoredChannel, SendCheckPref } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Checkbox, Page, PageHeader, Section, Surface, Text } from '@juno/ui'
import { AppearanceSettings, type AppearanceSettingsProps } from './AppearanceSettings'
import { IgnoredChannels } from './IgnoredChannels'
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
  readonly checks: ReadonlyArray<{ readonly key: SendCheckPref; readonly enabled: boolean }>
  readonly grammarUnavailable?: string | undefined
  readonly onCheckChange: (key: SendCheckPref, enabled: boolean) => void
  /** What a new tab opens: "+", ⌘T and the tab that replaces the last one closed. */
  readonly newTabPage: NewTabPageName
  readonly onNewTabPageChange: (page: NewTabPageName) => void
  readonly peekKey: PeekKeyName
  readonly onPeekKeyChange: (key: PeekKeyName) => void
  readonly classifier: boolean
  readonly onClassifierChange: (enabled: boolean) => void
}

/** General: what a new tab opens, the peek key and the fast classifier. */
export function SettingsGeneral({ newTabPage, onNewTabPageChange, peekKey, onPeekKeyChange, classifier, onClassifierChange, checks, grammarUnavailable, onCheckChange }: SettingsGeneralProps) {
  return (
    <Page width="settings">
      <PageHeader title="General" />
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
      <Section heading="Message checks" sub="Wrong place checks before sending. Other checks suggest small fixes after you send. You review and save every edit.">
        <Surface kind="group" padding="md" sx={styles.card}>
          <div {...stylex.props(styles.stack)}>
            {checks.map(({ key, enabled }) => <Checkbox key={key} label={checkLabels[key]} checked={enabled && !(key === 'grammar' && grammarUnavailable)} disabled={key === 'grammar' && grammarUnavailable !== undefined} onChange={(event) => onCheckChange(key, event.currentTarget.checked)} />)}
            {grammarUnavailable && <Text variant="meta" tone="muted" as="p">{grammarUnavailable}</Text>}
          </div>
        </Surface>
      </Section>
      <Section heading="AI assist" sub="Use a fast model for decisions. Off uses a small chat model for these decisions.">
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
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
  },
})
