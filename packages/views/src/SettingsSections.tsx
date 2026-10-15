import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { IgnoredChannel } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Checkbox, Page, PageHeader, Section, Surface, Text } from '@juno/ui'
import { AppearanceSettings, type AppearanceSettingsProps } from './AppearanceSettings'
import { IgnoredChannels } from './IgnoredChannels'
import { PeekKeySetting, type PeekKeyName } from './PeekKeySetting'

// The sections of Settings that are the app's own (SPEC 14). Notifications,
// Juno, Connections and Backup & This Mac are their own pages. Each section
// is a settings page with its title; `SettingsPage` puts the list beside it.

export interface SettingsGeneralProps {
  readonly peekKey: PeekKeyName
  readonly onPeekKeyChange: (key: PeekKeyName) => void
  readonly classifier: boolean
  readonly onClassifierChange: (enabled: boolean) => void
}

/** General: the peek key and the fast classifier. */
export function SettingsGeneral({ peekKey, onPeekKeyChange, classifier, onClassifierChange }: SettingsGeneralProps) {
  return (
    <Page width="settings">
      <PageHeader title="General" />
      <Section heading="Peek" sub="Hold the key over a topic in the sidebar to read it without marking it read.">
        <Surface kind="group" padding="md">
          <PeekKeySetting value={peekKey} onChange={onPeekKeyChange} />
        </Surface>
      </Section>
      <Section heading="AI assist" sub="Use a fast model for decisions. Turn this off to use the decision chat model.">
        <Surface kind="group" padding="md">
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
      <Surface kind="group" padding="md">
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
        <Surface kind="group" padding="md">
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
        <Surface kind="group" padding="md">
          <div {...stylex.props(styles.stack)}>
            {build}
            {updates}
          </div>
        </Surface>
      </Section>
      <Section heading="Diagnostics" sub="What the sync engine is doing. Useful when something looks wrong.">
        <Surface kind="group" padding="md">{diagnostics}</Surface>
      </Section>
    </Page>
  )
}

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
  },
})
