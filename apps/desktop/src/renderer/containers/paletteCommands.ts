/**
 * The ⌘K commands (spec section 10, inventory 9): the pages, the Settings
 * sections and the global commands, and the ones for the topic in the
 * active tab, grouped under its name. They show in the Conversations tab
 * when the text matches them, or all of them after a leading ">". Each
 * reuses the action the rest of the app runs: the sidebar's pages, the Juno
 * menu's pages, Settings by section, the theme and accent of Settings ›
 * Appearance, the New tab and New message commands, the account menu's presence
 * and privacy, the topic menu, and the huddle's controls and header button.
 */
import { AccentSchema, type Accent, type SettingsSection, type Theme } from '@juno/contract'
import {
  accentAtom,
  activeTab,
  currentPlace,
  huddleInChannelAtom,
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
  type OpenOptions,
} from '@juno/state'
import { junoPageTitles } from '@juno/agent-contract'
import { accentLabels, settingsSections, type PaletteIconName, type PaletteItem } from '@juno/views'
import { muteShortcut } from '@juno/huddle-views'
import { currentCall, joinHuddle, leaveCurrentHuddle, mediaSnapshot, shareFull, showCurrentHuddle, toggleHuddleMuted, toggleSharing } from './huddle/media'
import { closeJunoPanel, openPanel } from './juno/actions'
import { openAllTopics, openGallery, openDevLog, openHome, openJuno, openJunoPage, newMessage, openNewTab, openSettings, openTopic, showTheTour } from './navigation'
import { messageBeforePalette } from './paletteActions'
import { setPrivacy } from './privacy'
import { isLinkable, labelOf, runTopicAction, topicOf, type ActionTopic } from './topicActions'

/** Where a global row shows: under Pages, Settings or Commands. */
export type CommandGroup = 'pages' | 'settings' | 'commands'

/** The global groups, in the palette's order. */
export const commandGroups: ReadonlyArray<{ readonly group: CommandGroup; readonly heading: string }> = [
  { group: 'pages', heading: 'Pages' },
  { group: 'settings', heading: 'Settings' },
  { group: 'commands', heading: 'Commands' },
]

/**
 * A command row and what running it does. `words` are matched with the
 * label. `family` names the rows it belongs with ("theme", "settings"):
 * text that names it shows every row of the family. `stays`: it moves
 * nothing, so focus goes back to where it was.
 */
export interface CommandRow extends PaletteItem {
  readonly words: string
  readonly group: CommandGroup
  readonly family?: string
  readonly run: (options: OpenOptions) => void
  readonly stays?: boolean
  /** Listed only when the text names it (`namesHidden`), never in a listing or a near match. */
  readonly hidden?: boolean
}

const row = (id: string, icon: PaletteIconName, label: string, words: string, run: (options: OpenOptions) => void, extra: Partial<CommandRow> = {}): CommandRow => ({
  id: `cmd:${id}`,
  icon,
  label,
  words,
  group: 'commands',
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

/** Each Settings section's icon, as its list shows it, and other words for it. */
const sectionLook: Record<SettingsSection, { readonly icon: PaletteIconName; readonly words: string }> = {
  general: { icon: 'settings', words: 'new tab startup' },
  appearance: { icon: 'appearance', words: 'theme accent colour color dark light' },
  notifications: { icon: 'notifications', words: 'alerts sounds badges quiet hours' },
  ignored: { icon: 'ignored', words: 'muted hidden channels' },
  'tidy-up': { icon: 'tidy-up', words: 'resolve settled suggestions clean sidebar topics tabs quiet expiry' },
  juno: { icon: 'juno', words: 'ai assistant provider key model spend' },
  connections: { icon: 'connections', words: 'juno servers tools integrations' },
  backup: { icon: 'backup', words: 'recovery restore move mac' },
  about: { icon: 'about', words: 'version update' },
  'ai-activity': { icon: 'ai-activity', words: 'ai calls log cost spend models audit' },
}

function setTheme(theme: Theme): void {
  registry.set(themeAtom, theme)
  persistTheme(theme)
}

function setAccent(accent: Accent): void {
  registry.set(accentAtom, accent)
  persistAccent(accent)
}

/** The Juno chat is open: the active tab shows it, or its panel. */
function junoChatOpen(): boolean {
  const tab = activeTab(registry.get(tabsAtom))
  return tab !== undefined && (currentPlace(tab).kind === 'juno' || registry.get(junoPanelOpenAtom))
}

/**
 * The app's pages (SPEC 6): each opens in the current tab, or focuses a
 * tab that shows it; ⌘Enter opens it in a new tab. Juno's Connections and
 * Settings are Settings sections, so they are listed there.
 */
function pageRows(): ReadonlyArray<CommandRow> {
  const page = { group: 'pages', family: 'pages go', opensTab: true } as const
  const juno = { ...page, family: 'pages go juno' } as const
  const junoPage = (id: 'scheduled' | 'remembers' | 'memory' | 'activity', words: string) =>
    row(`page-${id}`, 'juno', junoPageTitles[id], `juno ${words}`, (options) => openJunoPage(id, options), juno)
  return [
    row('page-home', 'home', 'Home', 'start greeting', openHome, page),
    row('page-all-topics', 'all-topics', 'All topics', 'everything browse list threads', openAllTopics, page),
    row('page-gallery', 'gallery', 'Gallery', 'pictures art paintings space images', (options) => openGallery(undefined, options), page),
    row('page-juno', 'juno', 'Juno', 'ai assistant chat ask', openJuno, juno),
    junoPage('scheduled', 'schedule reminders later'),
    junoPage('remembers', 'memory remember facts'),
    ...(junoChatOpen() ? [junoPage('memory', 'chat')] : []),
    junoPage('activity', 'log history work'),
    row('page-settings', 'settings', 'Settings', 'preferences options', () => openSettings(), { group: 'pages', family: 'pages go settings', hint: '⌘,' }),
  ]
}

/** The huddle's controls while the user is in one (SPEC 20), as the Huddle menu has them. */
function huddleRows(): ReadonlyArray<CommandRow> {
  if (currentCall() === undefined) return []
  const media = mediaSnapshot()
  const muted = media?.local.muted === true
  const sharing = media?.localShare !== undefined
  return [
    muted
      ? row('huddle-mute', 'unmute', 'Unmute', 'huddle microphone mic', toggleHuddleMuted, { ...stays, hint: muteShortcut })
      : row('huddle-mute', 'mute', 'Mute', 'huddle microphone mic', toggleHuddleMuted, { ...stays, hint: muteShortcut }),
    ...(sharing
      ? [row('huddle-share', 'stop-sharing', 'Stop sharing', 'huddle screen share present', toggleSharing, stays)]
      : shareFull(media)
        ? []
        : [row('huddle-share', 'share-screen', 'Share screen…', 'huddle screen share present window', toggleSharing)]),
    row('huddle-leave', 'leave-huddle', 'Leave huddle', 'call hang up end', leaveCurrentHuddle, stays),
    row('huddle-show', 'huddle', 'Show huddle', 'call open', showCurrentHuddle),
  ]
}

/** The commands that do not need a topic, as things are now: the current theme and accent say "Current". */
export function globalCommands(): ReadonlyArray<CommandRow> {
  const theme = registry.get(themeAtom)
  const accent = registry.get(accentAtom)
  const privacy = registry.get(privacyAtom)
  const status = registry.get(notificationStatusAtom)
  const presence = status._tag === 'Success' ? status.value.presence : null
  return [
    ...pageRows(),
    ...settingsSections.map(({ section, label }) =>
      row(`settings-${section}`, sectionLook[section].icon, `Settings: ${label}`, sectionLook[section].words, (options) => openSettings(section, options), { group: 'settings', family: 'settings preferences' }),
    ),
    ...themes.map((option) => row(`theme-${option.theme}`, option.icon, `Theme: ${option.label}`, 'appearance mode', () => setTheme(option.theme), { ...stays, family: 'theme', ...(option.theme === theme ? { sub: 'Current' } : {}) })),
    ...AccentSchema.literals.map((name) => row(`accent-${name}`, 'theme-system', `Accent: ${accentLabels[name]}`, 'appearance', () => setAccent(name), { ...stays, family: 'accent colour color', accent: name, ...(name === accent ? { sub: 'Current' } : {}) })),
    row('new-tab', 'new-tab', 'New tab', 'open', openNewTab, { hint: '⌘T' }),
    // ⌘N: Home's composer with the destination list open (SPEC 12).
    row('new-message', 'new-message', 'New message', 'write compose dm send chat', () => newMessage(), { hint: '⌘N' }),
    // Hidden: the developer log shows only for "developer" or "dev log".
    row('dev-log', 'settings', 'Open developer log', 'dev', () => openDevLog(), { hidden: true }),
    // The welcome card (SPEC 4) again, as Help › Show the Tour brings it.
    row('tour', 'tour', 'Show the tour', 'help guide onboarding welcome tips how', () => showTheTour()),
    privacy
      ? row('privacy', 'show-text', 'Show message text', 'privacy mode screen share', () => setPrivacy(false), { ...stays, hint: '⌃⌘H' })
      : row('privacy', 'hide-text', 'Hide message text', 'privacy mode screen share blur', () => setPrivacy(true), { ...stays, hint: '⌃⌘H' }),
    ...huddleRows(),
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
    topic.kind === 'main' && huddleRow(topic.channel.id),
  ]
  return { heading: labelOf(topic), rows: rows.filter((candidate) => candidate !== false) }
}

/** Start huddle or Join huddle on a channel's or DM's Main, as its header button; none while the user is in this one. */
function huddleRow(channelId: string): CommandRow | false {
  if (currentCall()?.channelId === channelId) return false
  const running = registry.get(huddleInChannelAtom(channelId)) !== undefined
  return running
    ? row('huddle-join', 'huddle', 'Join huddle', 'call audio', () => void joinHuddle(channelId), stays)
    : row('huddle-start', 'huddle', 'Start huddle', 'call audio', () => void joinHuddle(channelId), stays)
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')

/** A family word shorter than this is named only in full, so "set" does not list every Settings section. */
const FAMILY_PREFIX = 4

/** Every typed word is one of the row's family words, or the start of one. */
function namesFamily(candidate: CommandRow, typed: ReadonlyArray<string>): boolean {
  if (candidate.family === undefined) return false
  const family = wordsOf(candidate.family)
  return typed.every((word) => family.some((own) => own === word || (word.length >= FAMILY_PREFIX && own.startsWith(word))))
}

/** The text names the hidden commands: the word "developer", or "dev log". */
export function namesHidden(text: string): boolean {
  const words = wordsOf(text)
  return words.includes('developer') || words.some((word, at) => word === 'dev' && words[at + 1]?.startsWith('log') === true)
}

/** The label starts with the text, word by word: "theme light" starts "Theme: Light". */
export function labelStartsWith(candidate: CommandRow, text: string): boolean {
  const label = wordsOf(candidate.label)
  return wordsOf(text).every((word, at) => label[at]?.startsWith(word) === true)
}

/**
 * The commands that match `text`: every typed word starts a word of the
 * label, its extra words or its family. Labels that start with the text
 * come first; otherwise the order stays as defined. At most `max` are kept,
 * except the rows of a family the text names, which all show.
 */
export function matchCommands(rows: ReadonlyArray<CommandRow>, text: string, max = Infinity): ReadonlyArray<CommandRow> {
  const typed = wordsOf(text)
  const hiddenNamed = namesHidden(text)
  const listed = rows.filter((candidate) => candidate.hidden !== true || hiddenNamed)
  if (typed.length === 0) return listed
  const found = listed.filter((candidate) => {
    const words = wordsOf(`${candidate.label} ${candidate.words} ${candidate.family ?? ''}`)
    return typed.every((word) => words.some((own) => own.startsWith(word)))
  })
  const ranked = found.toSorted((a, b) => Number(labelStartsWith(b, text)) - Number(labelStartsWith(a, text)))
  let left = max
  return ranked.filter((candidate) => namesFamily(candidate, typed) || left-- > 0)
}
