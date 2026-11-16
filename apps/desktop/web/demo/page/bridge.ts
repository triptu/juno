/**
 * `window.juno` in the read-only demo: the `JunoBridge` with nothing behind
 * it. The web shell's bridge (`web/page/bridge.ts`) reaches a host; here
 * there is none, so every answer is the shape the shell routes declare for
 * "not available here", launch preferences live as long as the page, and
 * no event ever fires.
 *
 * Kept: the HTML context menu, the clipboard, web links in a new browser
 * tab, and the app-menu keys a reader needs (tabs, Back and Forward, the
 * sidebar). The keys for surfaces the demo leaves out do nothing.
 */
import { menuAccelerator, type menuShortcuts, type JunoBridge, type MenuCommand } from '@juno/contract/channels'
import { commandKey, isWindows, keyPlatform, otherCommandKey } from '@juno/views'
import { popupMenu, trackPointer } from '../../page/menu'

const nothing = (): Promise<undefined> => Promise.resolve(undefined)
const never = (): (() => void) => () => {}
const noProvider = { active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } } as const
const noUpdates = { kind: 'unavailable' } as const
const noSources = { permission: 'denied', sources: [] } as const
const noPermission = { authorization: 'unknown', badges: 'unknown' } as const

const DEMO_COMMANDS = ['tab.previous', 'tab.next', 'history.back', 'history.forward', 'sidebar.toggle'] as const satisfies ReadonlyArray<keyof typeof menuShortcuts>

const menuListeners = new Set<(command: MenuCommand) => void>()

/** An accelerator ("CommandOrControl+Shift+[") as a test on a key event. */
function matches(accelerator: string, event: KeyboardEvent): boolean {
  const parts = accelerator.split('+')
  const key = parts.at(-1) ?? ''
  const wants = new Set(parts.slice(0, -1))
  // On Windows `CommandOrControl` is Ctrl, as Electron reads it there.
  const command = wants.has('CommandOrControl') || wants.has('Command')
  const meta = !isWindows && command
  const ctrl = wants.has('Control') || (isWindows && command)
  if (event.metaKey !== meta || event.ctrlKey !== ctrl || event.altKey !== (wants.has('Alt') || wants.has('Option')) || event.shiftKey !== wants.has('Shift')) return false
  return event.key.toLowerCase() === key.toLowerCase() || event.code === `Key${key.toUpperCase()}`
}

function menuCommandFor(event: KeyboardEvent): MenuCommand | undefined {
  for (const command of DEMO_COMMANDS) if (matches(menuAccelerator(command, keyPlatform), event)) return command
  if (commandKey(event) && !otherCommandKey(event) && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) return `tab.select.${Number(event.key) as 1}`
  return undefined
}

/** After the page's own handlers: a key nothing took goes to the "app menu", as macOS hands it on. */
function forwardMenuKeys(): void {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || menuListeners.size === 0) return
    const command = menuCommandFor(event)
    if (command === undefined) return
    event.preventDefault()
    for (const listener of menuListeners) listener(command)
  })
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
    getInfo: () => Promise.resolve({ name: 'Juno', version: 'demo', platform: 'darwin', electron: '' }),
    diagnostics: () => Promise.resolve({ processes: [], engine: 'demo', agent: 'stopped', uptime: performance.now() / 1000, window: document.hasFocus() ? 'window focused' : 'window hidden' }),
    copyDiagnostics: () => Promise.resolve('failed'),
    copySyncLog: () => Promise.resolve('failed'),
    showLogs: nothing,
    reportStagingFailure: nothing,
    reportState: nothing,
  },
  engine: { requestPort: () => Promise.resolve('failed'), restart: nothing },
  agent: {
    requestPort: () => Promise.resolve('failed'),
    setOpenRouterKey: () => Promise.resolve('failed'),
    provider: () => Promise.resolve(noProvider),
    setProvider: () => Promise.resolve('failed'),
    codex: () => Promise.resolve('missing'),
    codexSignIn: () => Promise.resolve('missing'),
    onProvider: never,
    chooseFolder: () => Promise.resolve(null),
    recoveryPhrase: () => Promise.resolve(null),
    typeRecoveryPhrase: () => Promise.resolve('failed'),
  },
  launch: { setTheme: nothing, setAccent: nothing, setTopicTitleLines: nothing, setDensity: nothing, setPrivacy: nothing, setSidebar: nothing, onPrivacy: never },
  window: { onFullScreen: never },
  sharing: { get: () => Promise.resolve({ hide: true, detection: 'missing' }), set: (hide) => Promise.resolve({ hide, detection: 'missing' }) },
  huddle: {
    register: () => Promise.resolve({ generation: 1, fakeMedia: true }),
    setMenu: nothing,
    openMicrophoneSettings: nothing,
    shareSources: () => Promise.resolve(noSources),
    allowScreenRecording: () => Promise.resolve(noSources),
    openScreenRecordingSettings: nothing,
    shareWindowOpen: () => Promise.resolve(false),
  },
  contextMenu: { popup: popupMenu },
  shell: {
    openExternal: (url) => {
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener')
      return nothing()
    },
    openInSlack: nothing,
    editUndo: nothing,
    downloadFile: () => Promise.resolve('failed'),
    openFile: () => Promise.resolve('failed'),
  },
  files: { quickLook: () => Promise.resolve('failed') },
  clipboard: {
    writeText: (text) => navigator.clipboard.writeText(text),
    writeImage: () => Promise.resolve('failed'),
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
    contentShown: nothing,
    setViewing: nothing,
    onOpen: never,
    test: nothing,
    permission: () => Promise.resolve(noPermission),
    requestPermission: () => Promise.resolve(noPermission),
    openSettings: nothing,
  },
  webPanel: { show: nothing, setBounds: nothing, hide: nothing, close: nothing, onState: never },
}

export function installDemoBridge(): void {
  Object.assign(window, { juno: bridge })
  trackPointer()
  forwardMenuKeys()
}
