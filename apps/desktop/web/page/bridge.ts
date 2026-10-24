/**
 * `window.juno` in the web shell: the `JunoBridge` the preload gives the
 * renderer in Electron, answered in the page with browser APIs. Every answer
 * has the shape the shell routes declare (`@juno/contract`'s `ShellRoutes`),
 * since the renderer decodes them.
 *
 * - Clipboard: `navigator.clipboard`. Open external: a new browser tab.
 *   Downloads: the browser's own, through the host.
 * - Launch preferences: localStorage (`launch.ts`).
 * - Context menus: a plain HTML menu (`menu.ts`).
 * - App-menu shortcuts: a key the page did not handle becomes its menu
 *   command, as macOS hands it to the app menu. The browser keeps some
 *   (⌘T, ⌘N, ⌘W) for itself.
 * - The test host answers engine/agent sockets, providers, notifications and
 *   folder selections through real services with memory OS boundaries.
 * - Native media/screen sharing, web panels, Quick Look, Codex sign-in and
 *   updates remain unavailable here.
 */
import { Channels, menuShortcuts, type JunoBridge, type MenuCommand } from '@juno/contract/channels'
import { DOWNLOAD_PATH } from '../paths'
import { saveLaunch, savedLaunch } from './launch'
import { popupMenu } from './menu'
import { answerMenu, installTestSeam, seam, testing } from './testSeam'
import { pageUrl } from './urls'
import { hostRequest, hostSyncLog, onHostEvent } from './host'
import { requestAgentPort } from './agent'

const nothing = (): Promise<undefined> => Promise.resolve(undefined)
const never = (): (() => void) => () => {}
const noProvider = { active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } } as const
const noUpdates = { kind: 'unavailable' } as const
const noSources = { permission: 'denied', sources: [] } as const
const noPermission = { authorization: 'unknown', badges: 'unknown' } as const

const menuListeners = new Set<(command: MenuCommand) => void>()

/** An accelerator ("CommandOrControl+Shift+[") as a test on a key event. */
function matches(accelerator: string, event: KeyboardEvent): boolean {
  const parts = accelerator.split('+')
  const key = parts.at(-1) ?? ''
  const wants = new Set(parts.slice(0, -1))
  const command = wants.has('CommandOrControl') || wants.has('Command')
  if (event.metaKey !== command || event.ctrlKey !== wants.has('Control') || event.altKey !== (wants.has('Alt') || wants.has('Option')) || event.shiftKey !== wants.has('Shift')) return false
  if (key === 'Space') return event.code === 'Space'
  return event.key.toLowerCase() === key.toLowerCase() || event.code === `Key${key.toUpperCase()}`
}

function menuCommandFor(event: KeyboardEvent): MenuCommand | undefined {
  for (const [command, accelerator] of Object.entries(menuShortcuts)) if (matches(accelerator, event)) return command as MenuCommand
  if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) return `tab.select.${Number(event.key) as 1}`
  return undefined
}

/**
 * After the page's own handlers: a key nothing took goes to the "app menu".
 * Not under test: keys Playwright sends never reach Electron's app menu, so the
 * lane's driver chooses menu items itself (`testSeam.ts`).
 */
function forwardMenuKeys(): void {
  if (testing) return
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || menuListeners.size === 0) return
    const command = menuCommandFor(event)
    if (command === undefined) return
    event.preventDefault()
    for (const listener of menuListeners) listener(command)
  })
}

function download(url: string, name: string): void {
  const link = document.createElement('a')
  link.href = `${DOWNLOAD_PATH}?${new URLSearchParams({ url, name }).toString()}`
  link.download = name
  link.click()
}

async function copyImage(src: string): Promise<'copied' | 'failed'> {
  try {
    const blob = await (await fetch(pageUrl(src))).blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return 'copied'
  } catch {
    return 'failed'
  }
}

const bridge: JunoBridge = {
  updates: {
    get: () => Promise.resolve(noUpdates),
    set: () => Promise.resolve(noUpdates),
    restart: nothing,
    check: () => Promise.resolve(noUpdates),
    download: () => Promise.resolve(noUpdates),
    notes: () => Promise.resolve({ kind: 'failed' }),
    onChange: never,
  },
  app: {
    getInfo: () => Promise.resolve({ name: 'Juno', version: 'web', platform: 'darwin', electron: '' }),
    diagnostics: () => Promise.resolve({ processes: [], engine: 'web shell', agent: 'stopped', uptime: performance.now() / 1000, window: document.hasFocus() ? 'window focused' : 'window hidden' }),
    copyDiagnostics: (input) => navigator.clipboard.writeText((input as { report: string }).report).then(() => 'copied', () => 'failed'),
    copySyncLog: (input) => testing ? hostSyncLog(input).then((text) => navigator.clipboard.writeText(text)).then(() => 'copied', () => 'failed') : Promise.resolve('failed'),
    showLogs: nothing,
    reportStagingFailure: (failure) => testing ? hostRequest(Channels.appReportStagingFailure, failure) : nothing(),
    reportState: nothing,
  },
  engine: {
    // The engine comes over the socket (`@juno/state/socket`); nothing asks for a port.
    requestPort: () => Promise.resolve('failed'),
    restart: nothing,
  },
  agent: {
    requestPort: () => testing ? requestAgentPort() : Promise.resolve('failed'),
    setOpenRouterKey: (key) => testing ? hostRequest(Channels.agentSetOpenRouterKey, { key }) : Promise.resolve('failed'),
    provider: () => testing ? hostRequest(Channels.agentProvider, undefined) : Promise.resolve(noProvider),
    setProvider: (change) => testing ? hostRequest(Channels.agentSetProvider, change) : Promise.resolve('failed'),
    codex: () => Promise.resolve('missing'),
    codexSignIn: () => Promise.resolve('missing'),
    onProvider: (listener) => onHostEvent((event) => { if (event.event === 'provider') listener(event.value) }),
    chooseFolder: (purpose) => testing ? hostRequest(Channels.agentChooseFolder, { purpose }) : Promise.resolve(null),
    recoveryPhrase: () => testing ? hostRequest(Channels.agentRecoveryPhrase, undefined) : Promise.resolve(null),
    typeRecoveryPhrase: (phrase) => testing ? hostRequest(Channels.agentTypeRecoveryPhrase, { phrase }) : Promise.resolve('failed'),
  },
  launch: {
    setTheme: (theme) => Promise.resolve(saveLaunch('theme', theme)),
    setAccent: (accent) => Promise.resolve(saveLaunch('accent', accent)),
    setTopicTitleLines: (lines) => Promise.resolve(saveLaunch('topicTitleLines', lines)),
    setDensity: (density) => Promise.resolve(saveLaunch('density', density)),
    setPrivacy: (privacy) => {
      saveLaunch('privacy', privacy ? 'on' : undefined)
      return testing ? hostRequest(Channels.launchSetPrivacy, { privacy }) : nothing()
    },
    setSidebar: ({ width, collapsed }) => Promise.resolve(saveLaunch('sidebar', `${width}${collapsed ? '-hidden' : ''}`)),
    onPrivacy: never,
  },
  window: { onFullScreen: never },
  sharing: {
    get: () => Promise.resolve({ hide: savedLaunch('hideWhileSharing') !== 'false', detection: 'missing' }),
    set: (hide) => {
      saveLaunch('hideWhileSharing', String(hide))
      return Promise.resolve({ hide, detection: 'missing' })
    },
  },
  huddle: {
    register: () => testing ? hostRequest(Channels.huddleRegister, undefined) : Promise.resolve({ generation: 1, fakeMedia: true }),
    setMenu: nothing,
    openMicrophoneSettings: () => {
      if (testing) seam.microphoneSettingsOpened += 1
      return nothing()
    },
    shareSources: () => Promise.resolve(noSources),
    allowScreenRecording: () => Promise.resolve(noSources),
    openScreenRecordingSettings: nothing,
    shareWindowOpen: () => Promise.resolve(false),
  },
  contextMenu: { popup: (items, at) => (testing ? answerMenu(items, at) : undefined) ?? popupMenu(items, at) },
  shell: {
    openExternal: (url) => {
      // As main's openInBrowser: web links and T3 threads only.
      if (testing && (/^(https?|mailto):/i.test(url) || /^t3-thread:\/\/v1\/[a-zA-Z0-9_-]+$/.test(url))) seam.browserLinks.push(url)
      else if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener')
      return nothing()
    },
    openInSlack: ({ teamId, channelId }) => {
      const url = new URL('slack://channel')
      url.searchParams.set('team', teamId)
      url.searchParams.set('id', channelId)
      if (testing) seam.slackLinks.push(url.toString())
      return nothing()
    },
    editUndo: () => {
      document.execCommand('undo')
      return nothing()
    },
    downloadFile: ({ url, name }) => {
      download(url, name)
      return Promise.resolve('saved')
    },
    openFile: () => Promise.resolve('failed'),
  },
  files: { quickLook: () => Promise.resolve('failed') },
  clipboard: {
    writeText: (text) => navigator.clipboard.writeText(text),
    writeImage: copyImage,
  },
  menu: {
    onCommand: (listener) => {
      menuListeners.add(listener)
      return () => {
        menuListeners.delete(listener)
      }
    },
  },
  notifications: {
    contentShown: () => testing ? hostRequest(Channels.notificationsContentShown, undefined) : nothing(),
    setViewing: (topicId) => testing ? hostRequest(Channels.notificationsViewing, { topicId }) : nothing(),
    onOpen: (listener) => onHostEvent((event) => { if (event.event === 'notification') listener(event.value) }),
    test: () => testing ? hostRequest(Channels.notificationsTest, undefined) : nothing(),
    permission: () => testing ? hostRequest(Channels.notificationsPermission, undefined) : Promise.resolve(noPermission),
    requestPermission: () => testing ? hostRequest(Channels.notificationsRequestPermission, undefined) : Promise.resolve(noPermission),
    openSettings: () => testing ? hostRequest(Channels.notificationsOpenSettings, undefined) : nothing(),
  },
  webPanel: { show: nothing, setBounds: nothing, hide: nothing, close: nothing, onState: never },
}

export function installBridge(): void {
  Object.assign(window, { juno: bridge })
  seam.menu = (command) => {
    for (const listener of menuListeners) listener(command)
  }
  installTestSeam()
  forwardMenuKeys()
}
