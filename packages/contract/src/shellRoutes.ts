/**
 * renderer -> main request/response routes over `ipcRenderer.invoke`: each
 * channel's input and output schema, which main decodes and encodes through.
 * Only main reads this map. It is its own module so the renderer's start
 * bundle, which imports the contract for other names, leaves it out.
 */
import { Schema } from 'effect'
import { Channels } from './channels'
import { AttachmentFailure } from './routes/files'
import {
  AccentSchema,
  AppInfo,
  AppState,
  CodexSetup,
  ContextMenuAt,
  ContextMenuItems,
  DensitySchema,
  Diagnostics,
  DiagnosticsCopy,
  DownloadResult,
  HuddleMenu,
  HuddleRegistration,
  NotificationPermission,
  PortRequestResult,
  ProviderChange,
  ProviderResult,
  ProviderState,
  ReleaseNotes,
  ShareSources,
  SharingSetting,
  SidebarLayout,
  SlackTarget,
  SyncLogInput,
  ThemeSchema,
  TopicTitleLinesSchema,
  UpdateState,
  WebPanelBounds,
} from './shell'

export const ShellRoutes = {
  [Channels.appCopyDiagnostics]: { input: DiagnosticsCopy, output: Schema.Literals(['copied', 'failed']) },
  [Channels.appCopySyncLog]: { input: SyncLogInput, output: Schema.Literals(['copied', 'failed']) },
  [Channels.appShowLogs]: { input: Schema.Void, output: Schema.Void },
  [Channels.updatesGet]: { input: Schema.Void, output: UpdateState },
  [Channels.updatesSet]: { input: Schema.Struct({ enabled: Schema.Boolean }), output: UpdateState },
  [Channels.updatesRestart]: { input: Schema.Void, output: Schema.Void },
  [Channels.updatesCheck]: { input: Schema.Void, output: UpdateState },
  [Channels.updatesDownload]: { input: Schema.Void, output: UpdateState },
  [Channels.updatesNotes]: { input: Schema.Struct({ scope: Schema.Literals(['installed', 'update']) }), output: ReleaseNotes },
  [Channels.appGetInfo]: { input: Schema.Void, output: AppInfo },
  [Channels.appDiagnostics]: { input: Schema.Void, output: Diagnostics },
  [Channels.appReportStagingFailure]: { input: Schema.Struct({ id: Schema.String, reason: AttachmentFailure, offset: Schema.Number }), output: Schema.Void },
  [Channels.appReportState]: { input: AppState, output: Schema.Void },
  [Channels.engineRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.engineRestart]: { input: Schema.Void, output: Schema.Void },
  [Channels.agentRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.agentSetOpenRouterKey]: {
    input: Schema.Struct({ key: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))) }),
    output: ProviderResult,
  },
  [Channels.agentProvider]: { input: Schema.Void, output: ProviderState },
  [Channels.agentSetProvider]: { input: ProviderChange, output: ProviderResult },
  [Channels.agentCodex]: { input: Schema.Void, output: CodexSetup },
  [Channels.agentCodexSignIn]: { input: Schema.Void, output: CodexSetup },
  [Channels.agentChooseFolder]: { input: Schema.Struct({ purpose: Schema.Literals(['backup', 'restore']) }), output: Schema.NullOr(Schema.String) },
  [Channels.agentRecoveryPhrase]: { input: Schema.Void, output: Schema.NullOr(Schema.String) },
  [Channels.agentTypeRecoveryPhrase]: {
    input: Schema.Struct({ phrase: Schema.String.check(Schema.isMaxLength(256)) }),
    output: Schema.Literals(['saved', 'invalid', 'failed']),
  },
  [Channels.launchSetTheme]: { input: Schema.Struct({ theme: ThemeSchema }), output: Schema.Void },
  [Channels.launchSetAccent]: { input: Schema.Struct({ accent: AccentSchema }), output: Schema.Void },
  [Channels.launchSetTopicTitleLines]: { input: Schema.Struct({ topicTitleLines: TopicTitleLinesSchema }), output: Schema.Void },
  [Channels.launchSetDensity]: { input: Schema.Struct({ density: DensitySchema }), output: Schema.Void },
  [Channels.launchSetPrivacy]: { input: Schema.Struct({ privacy: Schema.Boolean }), output: Schema.Void },
  [Channels.launchSetSidebar]: { input: SidebarLayout, output: Schema.Void },
  [Channels.sharingGet]: { input: Schema.Void, output: SharingSetting },
  [Channels.sharingSet]: { input: Schema.Struct({ hide: Schema.Boolean }), output: SharingSetting },
  [Channels.huddleRegister]: { input: Schema.Void, output: HuddleRegistration },
  [Channels.huddleMenu]: { input: Schema.Struct({ menu: HuddleMenu }), output: Schema.Void },
  [Channels.huddleMicrophoneSettings]: { input: Schema.Void, output: Schema.Void },
  [Channels.huddleShareSources]: { input: Schema.Void, output: ShareSources },
  [Channels.huddleAllowScreenRecording]: { input: Schema.Void, output: ShareSources },
  [Channels.huddleScreenRecordingSettings]: { input: Schema.Void, output: Schema.Void },
  [Channels.huddleShareWindowOpen]: { input: Schema.Struct({ id: Schema.String.check(Schema.isMaxLength(256)) }), output: Schema.Boolean },
  [Channels.contextMenuPopup]: { input: Schema.Struct({ items: ContextMenuItems, at: Schema.optionalKey(ContextMenuAt) }), output: Schema.NullOr(Schema.String) },
  [Channels.shellOpenExternal]: { input: Schema.Struct({ url: Schema.String }), output: Schema.Void },
  [Channels.shellOpenInSlack]: { input: SlackTarget, output: Schema.Void },
  [Channels.shellDownloadFile]: {
    input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(4096)), name: Schema.String.check(Schema.isMaxLength(512)) }),
    output: DownloadResult,
  },
  [Channels.shellOpenFile]: {
    input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(4096)), name: Schema.String.check(Schema.isMaxLength(512)) }),
    output: DownloadResult,
  },
  [Channels.filesQuickLook]: {
    input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(4096)), name: Schema.String.check(Schema.isMaxLength(512)) }),
    output: DownloadResult,
  },
  [Channels.clipboardWriteImage]: { input: Schema.Struct({ src: Schema.String.check(Schema.isMaxLength(8192)) }), output: Schema.Literals(['copied', 'failed']) },
  [Channels.clipboardWriteText]: { input: Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(2048)) }), output: Schema.Void },
  [Channels.shellEditUndo]: { input: Schema.Void, output: Schema.Void },
  [Channels.notificationsViewing]: { input: Schema.Struct({ topicId: Schema.NullOr(Schema.String) }), output: Schema.Void },
  [Channels.notificationsContentShown]: { input: Schema.Void, output: Schema.Void },
  [Channels.notificationsTest]: { input: Schema.Void, output: Schema.Void },
  [Channels.notificationsPermission]: { input: Schema.Void, output: NotificationPermission },
  [Channels.notificationsRequestPermission]: { input: Schema.Void, output: NotificationPermission },
  [Channels.notificationsOpenSettings]: { input: Schema.Void, output: Schema.Void },
  [Channels.webPanelShow]: { input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(8192)), bounds: WebPanelBounds }), output: Schema.Void },
  [Channels.webPanelBounds]: { input: WebPanelBounds, output: Schema.Void },
  [Channels.webPanelHide]: { input: Schema.Void, output: Schema.Void },
  [Channels.webPanelClose]: { input: Schema.Void, output: Schema.Void },
} as const

export type ShellRoutes = typeof ShellRoutes
export type ShellInput<C extends keyof ShellRoutes> = ShellRoutes[C]['input']['Type']
export type ShellOutput<C extends keyof ShellRoutes> = ShellRoutes[C]['output']['Type']
