/**
 * The ⌘K commands (spec section 10, inventory 9): the global ones, and the
 * ones for the topic in the active tab, grouped under its name. They show
 * in the Conversations tab when the text matches them, or all of them after
 * a leading ">". Each reuses the action the rest of the app runs: the theme
 * and accent of Settings › Appearance, the tab and New chat commands, the
 * account menu's presence and privacy, and the topic menu.
 */
import { AccentSchema, type Accent, type SettingsSection, type Theme } from '@juno/contract'
import {
  accentAtom,
  activeTab,
  junoAvailableAtom,
  junoPanelOpenAtom,
  notificationStatusAtom,
  persistAccent,
  persistTheme,
  privacyAtom,
  registry,
  setPresence,
  tabsAtom,
  tabTopic,
  themeAtom,
} from '@juno/state'
import { accentLabels, settingsSections, type PaletteIconName, type PaletteItem } from '@juno/views'
import { closeJunoPanel, openPanel } from './juno/actions'
import { openNewChat, openNewTab, openSettings, openTopic } from './navigation'
import { messageBeforePalette } from './paletteActions'
import { setPrivacy } from './privacy'
import { isLinkable, labelOf, runTopicAction, topicOf, type ActionTopic } from './topicActions'

/** A command row and what running it does. `words` are matched with the label. `stays`: it moves nothing, so focus goes back to where it was. */
export interface CommandRow extends PaletteItem {
  readonly words: string
  readonly run: () => void
  readonly stays?: boolean
}

const row = (id: string, icon: PaletteIconName, label: string, words: string, run: () => void, extra: Partial<CommandRow> = {}): CommandRow => ({
  id: `cmd:${id}`,
  icon,
  label,
  words,
  compact: true,
  run,
  ...extra,
})

const stays = { stays: true } as const

const themes: ReadonlyArray<{ readonly theme: Theme; readonly label: string; readonly icon: PaletteIconName }> = [
  { theme: 'light', label: 'Light', icon: 'theme-light' },
  { theme: 'dark', label: 'Dark', icon: 'theme-dark' },
  { theme: 'system', label: 'Match system', icon: 'theme-system' },
]

function setTheme(theme: Theme): void {
  registry.set(themeAtom, theme)
  persistTheme(theme)
}

function setAccent(accent: Accent): void {
  registry.set(accentAtom, accent)
  persistAccent(accent)
}

/** The commands that do not need a topic, as things are now: the current theme and accent say "Current". */
export function globalCommands(): ReadonlyArray<CommandRow> {
  const theme = registry.get(themeAtom)
  const accent = registry.get(accentAtom)
  const privacy = registry.get(privacyAtom)
  const status = registry.get(notificationStatusAtom)
  const presence = status._tag === 'Success' ? status.value.presence : null
  return [
    ...themes.map((option) => row(`theme-${option.theme}`, option.icon, `Theme: ${option.label}`, 'appearance mode', () => setTheme(option.theme), { ...stays, ...(option.theme === theme ? { sub: 'Current' } : {}) })),
    ...AccentSchema.literals.map((name) => row(`accent-${name}`, 'theme-system', `Accent: ${accentLabels[name]}`, 'colour color appearance', () => setAccent(name), { ...stays, accent: name, ...(name === accent ? { sub: 'Current' } : {}) })),
    row('new-tab', 'new-tab', 'New tab', 'open', openNewTab, { hint: '⌘T' }),
    row('new-chat', 'new-chat', 'New chat', 'message write compose', openNewChat, { hint: '⌘N' }),
    ...settingsSections.map(({ section, label }) => row(`settings-${section}`, 'settings', `Settings: ${label}`, 'preferences', () => openSettings(section as SettingsSection))),
    privacy
      ? row('privacy', 'show-text', 'Show message text', 'privacy mode screen share', () => setPrivacy(false), { ...stays, hint: '⌃⌘H' })
      : row('privacy', 'hide-text', 'Hide message text', 'privacy mode screen share blur', () => setPrivacy(true), { ...stays, hint: '⌃⌘H' }),
    ...(presence === null
      ? []
      : [
          presence === 'away'
            ? row('presence', 'presence', 'Set yourself active', 'status presence online', () => setPresence(registry, 'active'), stays)
            : row('presence', 'presence', 'Set yourself away', 'status presence offline', () => setPresence(registry, 'away'), stays),
        ]),
  ]
}

/** The topic in the active tab, if a topic is open there. */
function activeTopic(): ActionTopic | undefined {
  const tab = activeTab(registry.get(tabsAtom))
  const id = tab === undefined ? undefined : tabTopic(tab)
  return id === undefined ? undefined : topicOf(id)
}

/** The open topic's commands, under its name ("#eng" for a Main). Undefined when no topic is open. */
export function topicCommands(): { readonly heading: string; readonly rows: ReadonlyArray<CommandRow> } | undefined {
  const topic = activeTopic()
  if (topic === undefined) return undefined
  const run = (action: Parameters<typeof runTopicAction>[1]) => () => runTopicAction(topic, action, 'header')
  const selected = topic.kind === 'main' ? messageBeforePalette() : undefined
  const juno = registry.get(junoAvailableAtom)
  const panelOpen = registry.get(junoPanelOpenAtom)
  const rows: ReadonlyArray<CommandRow | false> = [
    topic.resolved ? row('reopen', 'reopen', 'Reopen', 'unresolve', run('reopen'), stays) : row('resolve', 'resolve', 'Resolve', 'done close', run('resolve'), stays),
    topic.pinned ? row('unpin', 'unpin', 'Unpin', 'pin', run('unpin'), stays) : row('pin', 'pin', 'Pin', 'keep top', run('pin'), stays),
    topic.unreadCount > 0 ? row('read', 'unread', 'Mark as read', 'unread', run('mark-read'), stays) : row('unread', 'unread', 'Mark as unread', 'read', run('mark-unread'), stays),
    juno && (panelOpen ? row('juno', 'juno', 'Close Juno panel', 'ai assistant', closeJunoPanel, { hint: '⌘J' }) : row('juno', 'juno', 'Open Juno panel', 'ai assistant ask', openPanel, { hint: '⌘J' })),
    isLinkable(topic) && row('copy-link', 'link', 'Copy Slack link', 'url share', run('copy-link'), stays),
    row('open-in-slack', 'open-in-slack', 'Open in Slack', 'app', run('open-in-slack'), stays),
    topic.kind === 'thread' && row('rename', 'rename', 'Rename thread', 'title', run('rename')),
    selected !== undefined && row('start-thread', 'start-thread', 'Start thread', 'reply selected message', () => openTopic(`t:${topic.channel.id}:${selected}`)),
  ]
  return { heading: labelOf(topic), rows: rows.filter((candidate) => candidate !== false) }
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')

/**
 * The commands that match `text`: every typed word starts a word of the
 * label or its extra words. Labels that start with the text come first;
 * otherwise the order stays as defined.
 */
export function matchCommands(rows: ReadonlyArray<CommandRow>, text: string): ReadonlyArray<CommandRow> {
  const typed = wordsOf(text)
  if (typed.length === 0) return rows
  const whole = text.trim().toLowerCase()
  const found = rows.filter((candidate) => {
    const words = wordsOf(`${candidate.label} ${candidate.words}`)
    return typed.every((word) => words.some((own) => own.startsWith(word)))
  })
  return found.toSorted((a, b) => Number(b.label.toLowerCase().startsWith(whole)) - Number(a.label.toLowerCase().startsWith(whole)))
}
