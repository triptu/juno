/**
 * IPC channel names and the shape of the `window.juno` bridge.
 *
 * This file has no runtime dependencies on purpose. The preload script bundles
 * it, and a sandboxed preload should stay tiny. Schemas live in shell.ts; the
 * types below are imported from them, which is erased at compile time.
 */
import type { Accent, Density, TopicTitleLines, ProviderChange, SidebarLayout, SlackTarget, Theme, WebPanelBounds } from './shell'

export type { Accent, Density, TopicTitleLines, ProviderChange, SidebarLayout, SlackTarget, Theme, WebPanelBounds } from './shell'

export const Channels = {
  updatesGet: 'updates.get',
  updatesSet: 'updates.set',
  updatesRestart: 'updates.restart',
  /** Without a Developer ID signature: saves the new version's DMG to Downloads and opens it. */
  updatesDownload: 'updates.download',
  /** "What's new": changelog entries from the releases repository, fetched when asked. */
  updatesNotes: 'updates.notes',
  appGetInfo: 'app.getInfo',
  /** Settings › About's diagnostics: each process's CPU and memory, and what the engine and agent supervisors are doing. */
  appDiagnostics: 'app.diagnostics',
  appLogDiagnostics: 'app.logDiagnostics',
  appShowLogs: 'app.showLogs',
  /** The renderer tells main its view and whether a sync runs, for main's idle CPU check (no titles, no ids). */
  appReportState: 'app.reportState',
  /** Renderer asks main for a fresh engine port. The port arrives on `Events.enginePort`. */
  engineRequestPort: 'engine.requestPort',
  /** Starts the engine again after the supervisor gave up on it. */
  engineRestart: 'engine.restart',
  /** Renderer asks main for a fresh port to the Juno Agent. The port arrives on `Events.agentPort`. */
  agentRequestPort: 'agent.requestPort',
  /** Stores the OpenRouter key in the keychain and hands it to the agent; null removes it. */
  agentSetOpenRouterKey: 'agent.setOpenRouterKey',
  /** The agent's provider state: which is active, and what is set up. */
  agentProvider: 'agent.provider',
  /** Sets up, removes or switches the agent's provider; keys go to the keychain. */
  agentSetProvider: 'agent.setProvider',
  /** Local Codex in Juno's own Codex home: missing, signed out or signed in. */
  agentCodex: 'agent.codex',
  /** Signs in to Codex in Juno's own Codex home (Codex opens the browser); the status after. */
  agentCodexSignIn: 'agent.codexSignIn',
  /** A folder picker for the backup folder or a backup to restore from; the chosen path, or null. */
  agentChooseFolder: 'agent.chooseFolder',
  /** The recovery phrase from the last export, once; null after that. */
  agentRecoveryPhrase: 'agent.recoveryPhrase',
  /** Stores a recovery phrase the owner typed, for a restore on a new Mac. */
  agentTypeRecoveryPhrase: 'agent.typeRecoveryPhrase',
  /** Remember the theme so the next launch paints the window in it. */
  launchSetTheme: 'launch.setTheme',
  /** Remember the accent so the next launch's first render already uses it. */
  launchSetAccent: 'launch.setAccent',
  /** Remember the density so the next launch's first render already uses it. */
  launchSetDensity: 'launch.setDensity',
  launchSetTopicTitleLines: 'launch.setTopicTitleLines',
  /** Remember privacy mode, so the next launch's first render already hides message text. */
  launchSetPrivacy: 'launch.setPrivacy',
  /** Remember the sidebar's width and hidden state so the next launch's first render has them. */
  launchSetSidebar: 'launch.setSidebar',
  /** "Hide message text while sharing the screen": whether it is on, and whether this Mac can tell. */
  sharingGet: 'sharing.get',
  /** Turns "Hide message text while sharing the screen" on or off; answers as `sharing.get`. */
  sharingSet: 'sharing.set',
  /** Gives the page its huddle media generation (routes/huddle.ts); main tells the engine while it is live. */
  huddleRegister: 'huddle.register',
  /** Shows a native context menu at the pointer and answers with the chosen item's id, or null. */
  contextMenuPopup: 'contextMenu.popup',
  /** Opens an http or https link in the default browser. */
  shellOpenExternal: 'shell.openExternal',
  /** Opens a conversation in the Slack app through its `slack://` link. */
  shellOpenInSlack: 'shell.openInSlack',
  /** Saves a Slack file into ~/Downloads on the Slack session and shows it in Finder. */
  shellDownloadFile: 'shell.downloadFile',
  /** Saves a Slack file into a temporary folder on the Slack session and opens it in the default app. */
  shellOpenFile: 'shell.openFile',
  /** Puts the image behind a `juno://files` or `juno://uploads` url on the clipboard. */
  clipboardWriteImage: 'clipboard.writeImage',
  /** Puts text on the clipboard. */
  clipboardWriteText: 'clipboard.writeText',
  /** Undo in the focused text field (`webContents.undo()`), for ⌘Z while one has text. */
  shellEditUndo: 'shell.editUndo',
  /** The topic the window shows, or null. Main adds whether the window is focused and tells the engine. */
  notificationsViewing: 'notifications.viewing',
  /** Settings › Notifications' Send test notification: one notification through the notifier. */
  notificationsTest: 'notifications.test',
  /** Whether macOS lets Juno post notifications, as a `NotificationPermission`. */
  notificationsPermission: 'notifications.permission',
  /** Asks macOS for permission (the system prompt, once); answers as `notifications.permission`. */
  notificationsRequestPermission: 'notifications.requestPermission',
  /** Opens System Settings at Juno's notifications. */
  notificationsOpenSettings: 'notifications.openSettings',
  /** Shows the web panel at `bounds` with `url`, loading it unless the panel already shows it. */
  webPanelShow: 'webPanel.show',
  /** Moves the shown web panel to new bounds. */
  webPanelBounds: 'webPanel.bounds',
  /** Hides the web panel and keeps its page, for ⌘K or another tab. */
  webPanelHide: 'webPanel.hide',
  /** Closes the web panel and frees its page. */
  webPanelClose: 'webPanel.close',
} as const

/** main -> preload messages sent with `webContents.postMessage`. */
export const Events = {
  updatesChanged: 'updates.changed',
  /** Carries one MessagePort in `ports[0]`. */
  enginePort: 'engine.port',
  /** Carries one MessagePort to the Juno Agent in `ports[0]`. */
  agentPort: 'agent.port',
  /** An app-menu item the renderer acts on, with a `MenuCommand`. */
  menuCommand: 'menu.command',
  /** A notification was clicked, with its `NotificationTarget`. */
  notificationOpen: 'notification.open',
  /** The agent's provider state changed, with the new `ProviderState`. */
  agentProviderChanged: 'agent.providerChanged',
  /** Main turned privacy mode on or off because sharing started or ended, with a `PrivacyState`. */
  privacyChanged: 'privacy.changed',
  /** The window entered or left macOS full screen, with a boolean: true in full screen. */
  windowFullScreen: 'window.fullScreen',
  /** The web panel's page changed, with a `WebPanelState`. */
  webPanelState: 'webPanel.state',
} as const

/**
 * The app-menu items main hands to the renderer (architecture, shortcuts):
 * the tab keys, Back and Forward (also the three-finger swipe), Hide
 * Sidebar, Hide Message Text (⌃⌘H), ⌘J for Juno, ⌘K for the palette, Edit › Undo, which undoes typing in a text field or else
 * Juno's last action, Settings (⌘,), which opens Settings, and Help › Show
 * the Tour, which brings the welcome card back on Home (SPEC 4).
 */
export type MenuCommand =
  /** ⌘T: a new tab with Home. */
  | 'tab.new'
  /** ⌘N: write a message from Home, with the destination list open. */
  | 'chat.new'
  | 'tab.close'
  | 'tab.reopen'
  | 'tab.next'
  | 'tab.previous'
  | `tab.select.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | 'history.back'
  | 'history.forward'
  | 'sidebar.toggle'
  | 'privacy.toggle'
  | 'juno.toggle'
  | 'palette.toggle'
  | 'edit.undo'
  | 'settings.open'
  /** Help › Show the Tour. No shortcut. */
  | 'tour.show'

/**
 * The app menu's shortcuts, in Electron's accelerator form. Main registers
 * them; the renderer shows them in tooltips and hints through
 * `shortcutKeys`, so a key changes in one place.
 */
export const menuShortcuts = {
  'chat.new': 'CommandOrControl+N',
  'tab.new': 'CommandOrControl+T',
  'tab.reopen': 'CommandOrControl+Shift+T',
  'tab.close': 'CommandOrControl+W',
  'tab.previous': 'CommandOrControl+Shift+[',
  'tab.next': 'CommandOrControl+Shift+]',
  'history.back': 'CommandOrControl+[',
  'history.forward': 'CommandOrControl+]',
  'sidebar.toggle': 'Control+Command+S',
  'privacy.toggle': 'Control+Command+H',
  'juno.toggle': 'CommandOrControl+J',
  'palette.toggle': 'CommandOrControl+K',
  'edit.undo': 'CommandOrControl+Z',
  'settings.open': 'CommandOrControl+,',
} as const satisfies Partial<Record<MenuCommand, string>>

const keyGlyphs: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Plus: '+',
}
// macOS writes the modifiers in this order, whatever order the accelerator uses.
const modifierOrder = ['⌃', '⌥', '⇧', '⌘']

/** An accelerator as the Mac writes it: "Control+Command+S" is "⌃⌘S". */
export function shortcutKeys(accelerator: string): string {
  const parts = accelerator.split('+').map((part) => keyGlyphs[part] ?? part)
  const key = parts.at(-1) ?? ''
  const modifiers = parts.slice(0, -1).toSorted((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b))
  return [...modifiers, key].join('')
}

/** The keys of an app-menu command, as the Mac writes them ("⌘["). */
export function menuKeys(command: keyof typeof menuShortcuts): string {
  return shortcutKeys(menuShortcuts[command])
}

/** One item of a context menu the renderer asks for, or a separator. */
export type ContextMenuLeaf =
  | {
      readonly id: string
      readonly label: string
      /** Default true. */
      readonly enabled?: boolean
      /** Draws a checkmark beside the item (the current Notify me choice). */
      readonly checked?: boolean
      /** A second, smaller line under the label (macOS 14.4 and later). */
      readonly sublabel?: string
      /** Shown in the shortcut column, in Electron's accelerator form ("CommandOrControl+W"). Display only. */
      readonly accelerator?: string
    }
  | { readonly separator: true }

/** An item, a separator, or a submenu of items one level deep. */
export type ContextMenuItem = ContextMenuLeaf | { readonly label: string; readonly submenu: ReadonlyArray<ContextMenuLeaf> }

/** Where a menu opens, in CSS pixels from the window's top left. Without it, at the pointer. */
export interface ContextMenuAt {
  readonly x: number
  readonly y: number
}

/** The sidebar's width range in CSS pixels, and the width a double-click on its edge resets to (spec section 4). */
export const SIDEBAR_WIDTH = { min: 312, max: 480, default: 384 } as const

/** The Juno panel's width in CSS pixels: `--juno-panel-min-width`, `--juno-panel-max-width` and `--juno-panel-width`. */
export const JUNO_PANEL_WIDTH = { min: 360, max: 640, default: 440 } as const

/** The tag the preload puts on the `window.postMessage` that forwards the port. */
export const PORT_HANDOFF_TAG = 'juno.enginePort'

/** The same for the Juno Agent's port. */
export const AGENT_PORT_HANDOFF_TAG = 'juno.agentPort'

/**
 * What the preload exposes to the renderer as `window.juno`.
 * Keep this surface small and typed. Never expose ipcRenderer itself.
 */
export interface JunoBridge {
  readonly updates: {
    readonly get: () => Promise<unknown>
    readonly set: (enabled: boolean) => Promise<unknown>
    readonly restart: () => Promise<unknown>
    readonly download: () => Promise<unknown>
    readonly notes: (scope: 'installed' | 'update') => Promise<unknown>
    readonly onChange: (listener: (state: unknown) => void) => () => void
  }
  readonly app: {
    /** Name, version and platform of the running app, answered by main. */
    readonly getInfo: () => Promise<unknown>
    /** A `Diagnostics`, answered by main. */
    readonly diagnostics: () => Promise<unknown>
    readonly logDiagnostics: () => Promise<unknown>
    readonly showLogs: () => Promise<unknown>
    /** An `AppState`: the view kind and whether a sync runs. */
    readonly reportState: (state: unknown) => Promise<unknown>
  }
  readonly engine: {
    /**
     * Asks main for a port to the engine. Resolves with a `PortRequestResult`;
     * on `sent` the port itself arrives as a `window` message tagged
     * PORT_HANDOFF_TAG.
     */
    readonly requestPort: () => Promise<unknown>
    /** Starts the engine again after main's supervisor gave up on it. A renderer waiting for a port then gets one. */
    readonly restart: () => Promise<unknown>
  }
  readonly agent: {
    /**
     * Asks main for a port to the Juno Agent. Resolves with a
     * `PortRequestResult`: `failed` while the agent is off or main gave up on
     * it. On `sent` the port arrives as a `window` message tagged
     * AGENT_PORT_HANDOFF_TAG.
     */
    readonly requestPort: () => Promise<unknown>
    /**
     * Stores the OpenRouter key in the macOS keychain through main and hands
     * it to the agent; `null` removes it. Resolves with `saved`, `removed`,
     * `invalid` (not a key: nothing was stored) or `failed` (the keychain
     * refused). Settings › Juno shows the result through its own stream.
     */
    readonly setOpenRouterKey: (key: string | null) => Promise<unknown>
    /**
     * The provider state (`ProviderState`): which provider is active, and
     * whether each is set up. With `active: null` the agent does not run and
     * the Juno tab and panel show "Add a provider".
     */
    readonly provider: () => Promise<unknown>
    /** Applies a `ProviderChange`; resolves with a `ProviderResult`. The agent starts or stops to match. */
    readonly setProvider: (change: ProviderChange) => Promise<unknown>
    /** Local Codex (`CodexSetup`): `missing` when the CLI is not installed, else signed in or out in Juno's own Codex home. */
    readonly codex: () => Promise<unknown>
    /** Runs Codex's sign-in in Juno's own Codex home, which opens the browser; resolves with the `CodexSetup` after. A signed-in Codex starts the agent. */
    readonly codexSignIn: () => Promise<unknown>
    /** Calls `listener` with each new `ProviderState`, undecoded. Returns the unsubscribe. */
    readonly onProvider: (listener: (state: unknown) => void) => () => void
    /** Shows the folder picker; resolves with the chosen absolute path, or null when cancelled. */
    readonly chooseFolder: (purpose: 'backup' | 'restore') => Promise<unknown>
    /**
     * The recovery phrase the agent just exported, for the sheet that shows
     * it. Main answers it once; later calls resolve with null.
     */
    readonly recoveryPhrase: () => Promise<unknown>
    /** Stores a phrase the owner typed in the keychain, before a restore. Resolves with `saved`, `invalid` or `failed`. */
    readonly typeRecoveryPhrase: (phrase: string) => Promise<unknown>
  }
  readonly launch: {
    readonly setTheme: (theme: Theme) => Promise<unknown>
    readonly setAccent: (accent: Accent) => Promise<unknown>
    readonly setTopicTitleLines: (topicTitleLines: TopicTitleLines) => Promise<unknown>
    readonly setDensity: (density: Density) => Promise<unknown>
    readonly setPrivacy: (privacy: boolean) => Promise<unknown>
    readonly setSidebar: (sidebar: SidebarLayout) => Promise<unknown>
    /** Calls `listener` with each `PrivacyState` main sets because sharing started or ended, undecoded. Returns the unsubscribe. */
    readonly onPrivacy: (listener: (state: unknown) => void) => () => void
  }
  readonly window: {
    /** Calls `listener` each time the window enters or leaves full screen, with the new state undecoded. Returns the unsubscribe. */
    readonly onFullScreen: (listener: (fullScreen: unknown) => void) => () => void
  }
  readonly sharing: {
    /** Resolves with a `SharingSetting`. */
    readonly get: () => Promise<unknown>
    /** Turns hiding while sharing on or off; resolves with the `SharingSetting` after. */
    readonly set: (hide: boolean) => Promise<unknown>
  }
  readonly huddle: {
    /** Resolves with a `HuddleRegistration`: this page load's media generation, a number main gives out in rising order, the same one until the page goes. */
    readonly register: () => Promise<unknown>
  }
  readonly contextMenu: {
    /** Resolves with the chosen item's id, or null when the menu closed without a choice. */
    readonly popup: (items: ReadonlyArray<ContextMenuItem>, at?: ContextMenuAt) => Promise<unknown>
  }
  readonly shell: {
    /** Only http and https links open; main ignores anything else. */
    readonly openExternal: (url: string) => Promise<unknown>
    readonly openInSlack: (target: SlackTarget) => Promise<unknown>
    /** Undo in the focused text field. */
    readonly editUndo: () => Promise<unknown>
    /** Only Slack file urls download; main answers `saved` or `failed`. */
    readonly downloadFile: (file: { readonly url: string; readonly name: string }) => Promise<unknown>
    /** Only Slack file urls open; main answers `saved` once the default app was asked to open it, or `failed`. */
    readonly openFile: (file: { readonly url: string; readonly name: string }) => Promise<unknown>
  }
  readonly clipboard: {
    readonly writeText: (text: string) => Promise<unknown>
    /** Only `juno://files` and `juno://uploads` images; main answers `copied` or `failed`. */
    readonly writeImage: (src: string) => Promise<unknown>
  }
  readonly menu: {
    /** Calls `listener` for each app-menu command. Returns the unsubscribe. */
    readonly onCommand: (listener: (command: MenuCommand) => void) => () => void
  }
  readonly notifications: {
    /** The topic the window shows now, or null for a page or nothing. */
    readonly setViewing: (topicId: string | null) => Promise<unknown>
    /** Calls `listener` with the target of each clicked notification, undecoded. Returns the unsubscribe. */
    readonly onOpen: (listener: (target: unknown) => void) => () => void
    /** Posts one test notification the way a message's is posted. */
    readonly test: () => Promise<unknown>
    /** Resolves with a `NotificationPermission`. */
    readonly permission: () => Promise<unknown>
    /** Shows the macOS prompt while permission is not determined; resolves with the `NotificationPermission` after. */
    readonly requestPermission: () => Promise<unknown>
    /** Opens System Settings at Juno's notifications. */
    readonly openSettings: () => Promise<unknown>
  }
  /** The web panel (SPEC 7): one page per window, drawn by main over the panel's place in the layout. */
  readonly webPanel: {
    readonly show: (url: string, bounds: WebPanelBounds) => Promise<unknown>
    readonly setBounds: (bounds: WebPanelBounds) => Promise<unknown>
    readonly hide: () => Promise<unknown>
    readonly close: () => Promise<unknown>
    /** Calls `listener` with each `WebPanelState`, undecoded. Returns the unsubscribe. */
    readonly onState: (listener: (state: unknown) => void) => () => void
  }
}
