/**
 * IPC channel names and the shape of the `window.juno` bridge.
 *
 * This file has no runtime dependencies on purpose. The preload script bundles
 * it, and a sandboxed preload should stay tiny. Schemas live in shell.ts; the
 * types below are imported from them, which is erased at compile time.
 */
import type { Accent, Density, ProviderChange, SidebarLayout, SlackTarget, Theme } from './shell'

export type { Accent, AppInfo, Density, Platform, ProviderChange, ProviderKind, ProviderResult, ProviderState, SidebarLayout, SlackTarget, Theme } from './shell'

export const Channels = {
  updatesGet: 'updates.get',
  updatesSet: 'updates.set',
  updatesRestart: 'updates.restart',
  appGetInfo: 'app.getInfo',
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
  /** Remember privacy mode, so the next launch's first render already hides message text. */
  launchSetPrivacy: 'launch.setPrivacy',
  /** Remember the sidebar's width and hidden state so the next launch's first render has them. */
  launchSetSidebar: 'launch.setSidebar',
  /** Shows a native context menu at the pointer and answers with the chosen item's id, or null. */
  contextMenuPopup: 'contextMenu.popup',
  /** Opens an http or https link in the default browser. */
  shellOpenExternal: 'shell.openExternal',
  /** Opens a conversation in the Slack app through its `slack://` link. */
  shellOpenInSlack: 'shell.openInSlack',
  /** Saves a Slack file into ~/Downloads on the Slack session and shows it in Finder. */
  shellDownloadFile: 'shell.downloadFile',
  /** Puts text on the clipboard. */
  clipboardWriteText: 'clipboard.writeText',
  /** Undo in the focused text field (`webContents.undo()`), for ⌘Z while one has text. */
  shellEditUndo: 'shell.editUndo',
  /** The topic the window shows, or null. Main adds whether the window is focused and tells the engine. */
  notificationsViewing: 'notifications.viewing',
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

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
} as const

/**
 * The app-menu items main hands to the renderer (architecture, shortcuts):
 * the tab keys, Back and Forward (also the three-finger swipe), Hide
 * Sidebar, Hide Message Text (⌃⌘H), ⌘J for Juno, Edit › Undo, which undoes typing in a text field or else
 * Juno's last action, and Settings (⌘,), which opens Preferences.
 */
export type MenuCommand =
  | 'tab.new'
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
  | 'edit.undo'
  | 'preferences.open'

/** One item of a context menu the renderer asks for, or a separator. */
export type ContextMenuLeaf =
  | {
      readonly id: string
      readonly label: string
      /** Default true. */
      readonly enabled?: boolean
      /** Draws a checkmark beside the item (the current Notify me choice). */
      readonly checked?: boolean
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
export const SIDEBAR_WIDTH = { min: 280, max: 480, default: 384 } as const

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
    readonly onChange: (listener: (state: unknown) => void) => () => void
  }
  readonly app: {
    /** Name, version and platform of the running app, answered by main. */
    readonly getInfo: () => Promise<unknown>
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
    readonly setDensity: (density: Density) => Promise<unknown>
    readonly setPrivacy: (privacy: boolean) => Promise<unknown>
    readonly setSidebar: (sidebar: SidebarLayout) => Promise<unknown>
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
  }
  readonly clipboard: {
    readonly writeText: (text: string) => Promise<unknown>
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
  }
}
