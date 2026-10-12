# Slack desktop shell (macOS) — reverse engineering notes

Target: `/Applications/Slack.app` 4.52.178 (Electron 44.4.5, bundle id `com.tinyspeck.slackmacgap`), analysed 2026-10-12.
Scope: the Electron shell only (`app.asar` + `app.asar.unpacked`). The Slack web client that runs inside it is out of scope except where the shell touches it.

How the evidence was gathered

- REA `analyze_javascript_application` on `Contents/Resources/app.asar` (integrity policy `record-and-continue`, because the eight unpacked `.node` addons are re-signed after packing and no longer match the asar header). Parent evidence `ev_2231fd439b6191330f91610f7e03aefac6273f5f7ad5b43ed538967a4e9d3504`, summary view `ev_cfe8d74e4fcf1225b1df8c0434f8fcc57342acbb938176e0be536dae4bc3b48a`, preload node view `ev_16459c4c346c0e2bf71162ca63e90c9dbd78e64db6247d6082463394e796e53e`. REA parsed 529 JS files / 1.38M AST nodes. Because the shipped bundles are minified (single expressions, no source maps shipped), REA's Electron facet found only 1 context-bridge API and 3 IPC operations statically; the detail below therefore comes from reading the bundles directly.
- The asar was extracted to `/tmp/juno-re/asar` and each bundle was run through prettier into `/tmp/juno-re/pretty/<same name>`. Line numbers below (`main:59447` etc.) refer to those prettified copies, not the originals.
- Read-only checks of `Info.plist`, code-sign entitlements, `@electron/fuses read`, file names (never values) under `~/Library/Application Support/Slack`, and keychain item metadata.
- No secret values were read, copied or logged. Cookie and token storage is described by location and format only.

## Summary

Slack's shell is a single-package TypeScript app (`slack-desktop`, Yarn 4 workspaces) built with rspack into a handful of flat bundles: a tiny `boot` CJS entry, one large `main` process bundle, one preload for the web client, one preload for the shell's own small HTML windows, and a few one-shot child-process scripts. The web client (`https://app.slack.com/...`) is loaded straight into a frameless `BrowserWindow` on the Chromium default session; there is no BrowserView/WebContentsView, no `<webview>`, and no shell-owned service worker. Sign-in is done by the web client itself inside that window; the shell only (a) handles `slack://` deep links, (b) runs a "magic login" flow (`auth.loginMagicBulk`) in a hidden window whose cookies land in the same session, and (c) on macOS can drive native `ASWebAuthenticationSession` via the `electron-native-auth` addon. The session is the `d` cookie on `.slack.com` (Secure, HttpOnly, SameSite=Lax), encrypted at rest by Chromium using the "Slack Safe Storage" keychain item. The web client talks to the shell via one `contextBridge` object, `window.desktop` (alias `window.winssb`), backed by string-named `ipcRenderer.invoke/send` channels; the shell talks back by calling methods on a delegate object the web client registers (`window.desktopDelegate`). Notifications are `desktop.notice.notify(payload)` → IPC `SLACK_NOTIFY` → `new electron.Notification(...)` in main. The main window uses `titleBarStyle: "hidden"`, `trafficLightPosition: {x:14, y:11}`, optional `vibrancy: "titlebar"`, and the web client draws its own drag regions. Security posture is strict: `sandbox`, `contextIsolation`, no `nodeIntegration`, `app.enableSandbox()`, a watchdog that destroys any window created with weaker settings, hardened fuses, asar integrity, and a custom `app://` scheme with a path-traversal guard for local HTML.

## 1. Codebase organisation

### Observed

Package (`/tmp/juno-re/asar/package.json`):

- `name: slack-desktop`, `main: ./dist/boot.bundle.cjs`, `engines.node >= 24`, `packageManager: yarn@4.12.0`, repo `tinyspeck/slack-desktop`, `private: true`, commit `5f3348f`.
- Yarn workspaces: `spec/e2e`, `spec/old-joe`, `tools/triage-agent` (tests and tooling, not runtime).
- Build: `@rspack/core 2.1.3` + `@swc/core`; the `build` script is `tsgo -b ./rspack/tsconfig.json && ts-node ./build/prepare-unreads-badge-resources.ts && node ./.rspack/runner.js`. So rspack config lives in `rspack/` and is itself TypeScript compiled with `tsgo` (`@typescript/native-preview`).
- TypeScript project references, from `compile:projects`: `src/common`, `src/boot`, `src/preload`, `src/browser`, `src/renderer`, `rspack`, `build`, `spec/jest`. (`src/browser` is Electron's "browser" = main process.)
- Lint-staged rule mentions `src/common/{interfaces,constants,utils}/**/*.ts` → `build/cli/publish-types/...` and `src/common/metadata/*.metadata.json`: shared types are published as a package (`publish-desktop-types`) so the web client can consume the bridge's type definitions.
- Tooling: `oxlint`, `prettier --experimental-cli`, `knip`, `dependency-cruiser` with `.dependency-cruiser.js` (`test:dependencies`), `husky`, `jest` with `@swc/jest` and `@testing-library/preact`, `@electron/fuses`, `@electron-forge` 8 alpha (dmg, zip), `@electron/osx-sign`, `@electron/notarize`, `electron-winstaller`, `electron-wix-msi`, `electron-windows-msix`, `appdmg`, `@sentry/webpack-plugin` (source maps uploaded to Sentry, not shipped), `csp-rspack-plugin` (patched).
- Runtime deps: `redux`, `@reduxjs/toolkit`, `redux-observable`, `rxjs`, `electron-redux` (patched), `redux-persist` + `redux-persist-node-storage` (patched), `preact` + `react-redux`, `joi` (IPC payload validation), `winston` (logs), `@sentry/electron` (patched), `dompurify`, `electron-chrome-web-store` (dev-tools extensions), `message-format` (i18n), `less` (styles for shell HTML).
- Native addons (all under `app.asar.unpacked/node_modules`): `@tinyspeck/native-keymap`, `@tinyspeck/slack-desktop-utils` (N-API, `slackdesktoputils.node`), `cf-prefs` (macOS CFPreferences / managed settings), `electron-native-auth` (macOS `ASWebAuthenticationSession`), `file-handler-info`, `macos-notification-state` (DND / focus state), `registry-js` and `windows-focus-assist` (Windows only).

Shipped bundles (`dist/`, sizes from the extracted asar):

| File | Role | Size |
| --- | --- | --- |
| `boot.bundle.cjs` | main entry: parses argv, redirects `userData`, requires main | 61 KB |
| `main.bundle.cjs` | the whole main process | 1.7 MB |
| `898.bundle.cjs` | lazily required main-process chunk (vendor: form-data, async helpers) | 172 KB |
| `preload.bundle.js` | preload for the web client window (`window.desktop`) | 763 KB |
| `component-preload-entry-point.bundle.js` | preload for shell-owned HTML windows (about, settings editor, net-log, basic-auth, HTML notifications) | 618 KB |
| `child-preload-entry-point.bundle.js` | preload for `window.open` children of the web client | 17 KB |
| `magic-login-preload-entry-point.bundle.js` | one-purpose preload: returns `document.body.innerText` of an API response over IPC | 0.7 KB |
| `call-get-macos-notification-state-entry-point.bundle.cjs` and 3 siblings | tiny scripts run in a child process to call a native addon out-of-process | <1 KB each |
| `settings-editor.bundle.js`, `net-log-window.bundle.js`, `basic-auth-view.bundle.js` + `.html` | preact renderers for the shell's own windows | 130–310 KB |
| `resources/` (unpacked) | tray template icons, taskbar `.ico` | |
| fonts, mp3s | Lato woff2, notification/call sounds | |

Other organisation facts:

- Source-map comments point to `*.bundle.js.map` files that are not shipped; the only path hints left are LESS imports: `src/renderer/styles/{settings-editor,net-log-window,basic-auth-view}.less`, `src/preload/styles/{window-chrome,window-chrome-app-menu,unreachable-webdata}.less`.
- Every bundle begins with a Sentry debug-id stub (`SENTRY_RELEASE = Slack@4.52.178`) and ends with `sandboxedRenderer = {}`; preloads use the Electron sandboxed-renderer module wrapper.
- Main process is organised as a Redux store plus redux-observable "epics" with string names (`initializeMainWindowEpic`, `magicLoginEpic`, `setBadgeEpic`, `htmlWindowCreationEpic`, `autoUpdaterLifecycleEpic`, ...; `main:49695-49842`). State is shared to renderers with `electron-redux`, persisted with `redux-persist` to `~/Library/Application Support/Slack/storage/root-state.json` (top-level keys observed: `appTeams, bookmarks, diagnostics, downloads, settings, teams, webapp, workspaces, workspacesMeta, _persist`). Simple launch settings are in `local-settings.json` (`electronFeatureOverrides, lastEffectiveClientEnvironment, lastElectronVersionLaunched, releaseChannelOverride, useHwAcceleration`).
- IPC channel names are a flat string enum shared by main and preloads (`child-preload:440-612` lists ~110 of them; e.g. `SLACK_NOTIFY`, `SET_FULL_SCREEN`, `TITLEBAR_DOUBLE_CLICK`, `BROWSER_WINDOW_SET_WINDOW_BUTTON_POSITION`). Main validates every payload with `joi` schemas keyed by channel (`main:51292`, `main:51355`, `main:51390`).
- Window types are a string enum: `webapp`, `notifications`, `about-box`, `settings-editor`, `basic-auth-view`, `net-log-window` (`main:42164-42169`).
- Logs: `~/Library/Application Support/Slack/logs/default/{browser.log, webapp-console.log, webapp-service-worker-console.log}` (file names observed). Renderer and service-worker console output is captured in main via `webContents`/`session.serviceWorkers` `console-message` events (`main:52764-52841`).
- Boot (`boot:3285-3364`): parses CLI with `command-line-args`, exits if `--troubleshoot`, and unless `--user-data-dir` is given moves `userData` to `Slack`, `SlackDevEnv`, `SlackDevMode` or `SlackIntegrationTest` under `appData`, then `require("./main.bundle.cjs")`. Main then takes `requestSingleInstanceLock` (non-MAS only), applies Chromium switches and starts (`main:66555-66575`).

### Inferred

- Source tree is `src/{boot,browser,preload,renderer,common}` with `common` holding the IPC constants, interfaces and joi schemas that both sides import; the published-types step means the web client repo depends on `@tinyspeck/...desktop types` generated from `src/common`. This is the pattern worth copying: one `shared` package that owns channel names, payload types and validators.
- rspack emits one entry per process (`boot`, `main`, each preload, each child script, each renderer page), with `splitChunks` producing the single `898` chunk for main.
- `spec/old-joe` is probably the legacy e2e harness; `tools/triage-agent` an internal bug-triage bot.

### Unknown

- Exact directory layout inside `src/browser` (minification removed module paths). The dependency-cruiser rules that enforce boundaries are not shipped.

## 2. How the shell loads the Slack web client

### Observed

- Main window creation (`main:59425-59560`, epic `INITIALIZE_MAIN_WINDOW`): a plain `BrowserWindow` created through the shared factory `iq.H2` (`main:44052-44092`). Options: `title: "Slack"`, `show: false`, `frame: !(win32 || darwin)` i.e. frameless on macOS, `titleBarStyle: "hidden"`, `fullscreenable: true`, `minWidth 668 / minHeight 400`, `acceptFirstMouse: !darwin`, `paintWhenInitiallyHidden: false`, `webPreferences: { session, preload: preload.bundle.js, additionalArguments: [windowType=webapp], enableBlinkFeatures, disableBlinkFeatures }`. No `BrowserView`, `WebContentsView` or `webviewTag` anywhere in the bundles (0 hits); `webviewTag: false` is forced.
- URL (`main:59497-59540`, "getSonicBootURL"): base is `https://app.slack.com` (gov/mil variants exist). If a workspace is already selected the path is `/client/<workspaceId>`; otherwise `/ssb/first?redir=/ssb/client`, plus `lsp=<port>` of a localhost HTTP server (`main:59395-59423`) the sign-in page can POST a `magic_login_uri` to, and `aswebauth=1` when the sign-in method is native. Dev "boot fragments" (`force_cold_boot`, `js_path`, ...) are appended as query params. User agent is set explicitly to a string containing `Slack_SSB/4.52.178` (`main:67592`).
- Session (`main:10370` module at `main:66570-66597`): in production normal mode the web client uses `session.defaultSession` (constant `PROD_DEFAULT_SESSION`); alternate/dev modes use `session.fromPartition("persist:<mode><DevEnv|Dev>")`. Shell-owned HTML windows use the non-persistent partition `"slack-component"` (`ex.e0`). On disk this matches: `~/Library/Application Support/Slack` has `Cookies`, `Local Storage`, `IndexedDB/https_app.slack.com_0.*`, `Service Worker/`, and no `Partitions/` directory.
- Local HTML for shell windows is served over a custom privileged scheme `app://resources/<file>.html` (`registerSchemesAsPrivileged` with `standard, secure`; `protocol.handle("app", ...)` on both the default and component sessions; `main:66061-66075`, `66228-66229`). The handler (`main:63392-63425`) rejects non-`resources` hosts, `..`, and paths outside `__dirname`, then `net.fetch(pathToFileURL(...))`.
- Service workers: the shell registers none. It only (a) clears `serviceWorkers` on sign-out/reset (`main:51033`, `61507`), (b) pipes service-worker console output to a log (`main:52766`), and (c) for installed dev-tools extensions calls `session.serviceWorkers.startWorkerForScope` (`main:59120`). The web client's own service worker (`Service Worker/CacheStorage`, `ScriptCache` on disk) is the web app's business.
- Navigation control: `will-navigate` / `will-redirect` on every window compare the target against an allowlist of Slack domains (`slack.com`, `slack-edge.com`, `slack-files.com`, `.eu`, `-gov`, `.mil` variants; `main:41636-41744`). Off-list navigations are blocked and `slack:` URLs become deep-link actions; everything else goes to `shell.openExternal` (`main:44141-44160`, `55545-55590`). `setWindowOpenHandler` + `did-create-window` apply the same factory and the child preload to popups (`main:55505`, `55590-55600`).
- Downloads: file downloads are done by loading the file URL into a hidden `BrowserWindow` on the same session and listening to `session.on("will-download")`, then setting a unique `savePath` under the user's chosen folder (`main:57800-57860`). Default folder is `~/Downloads` (`app.getPath("downloads")` on MAS; `main:61769`).
- Spellcheck: Chromium's built-in spellchecker with `spellcheck: true` as the factory default for every window (overridable, unlike the security keys) and `setSpellCheckerDictionaryDownloadURL("https://spellcheck.slack-edge.com/dictionaries_v2/")` (`main:41691`, `50613`); retry logic on `spellcheck-dictionary-download-failure` (`main:57585-57625`); the context menu offers `replaceMisspelling` (`main:56000`).
- Permissions: `session.setPermissionRequestHandler` / `setPermissionCheckHandler` grant based on the requesting origin being a Slack origin and whether the frame is the main window (`main:66237-66270`).

### Inferred

- Because the web client is a normal top-level document in the window (not a view inside a shell UI), the shell has no UI of its own in the main window; the sidebar, title bar and tab strip are all drawn by the web client. That is why the shell can get away with a single preload and a delegate pattern.
- Using `defaultSession` (not a named partition) is a legacy choice that is now load-bearing: sign-in windows, download windows and the magic-login window all pass `session` explicitly to share cookies.

### Unknown

- Whether the web client's service worker is relied on for offline boot in the desktop (`force_cold_boot` fragment suggests a warm-boot cache exists, but that lives in the web client).

## 3. Authentication

### Observed

- Entry: the shell loads `https://app.slack.com/ssb/first?redir=/ssb/client` and the web sign-in pages do the actual login inside the main window. Settings `signInMethod` has values `BROWSER`, `PLATFORM_NATIVE`, `PLATFORM_NATIVE_DIRECT_SAML` (`main:59520-59534`).
- Deep links: `Info.plist` registers URL scheme `slack` and document type `.slacktoken`. Main calls `app.setAsDefaultProtocolClient("slack")` (`main:66361`) and handles `app.on("open-url")` (`main:66076-66090`), queuing the URL until the store is ready, then dispatching `HANDLE_DEEP_LINK`. Second-instance launches pass `protoUrl` through the single-instance lock. Deep links are forwarded to the web client over IPC `FORWARD_DEEP_LINK` → `window.desktopDelegate.handleDeepLinkWithArgs(json)` (`preload:31843-31848`).
- Magic links: links matching `/magic-login/<token>` (regex `main:41744`, `67004`, `67319`) are turned into a hidden `BrowserWindow` on the web client's session with `magic-login-preload-entry-point.bundle.js`, which loads `https://<team host>/api/auth.loginMagicBulk?magic_tokens=<...>&ssb=1[&vend_sameparty_cookies=1]` (`main:51578-51660`). The preload replies with `document.body.innerText` on channel `SLACK_MAGIC_LOGIN_RESPONSE`; main parses the JSON, then `session.cookies.flushStore()` and verifies a `d` and `lc` cookie now exist (only presence/domains are logged), closes the window, and handles `auth_redir` (browser redirect) or `team.url` (switch to gov/mil environment). Epic `MAGIC_LOGIN_ON_FOCUS` re-checks the clipboard/args on focus.
- Native SSO on macOS (`main:59768-59815`, epic `START_NATIVE_AUTH`): when the web page navigates to `/ssb/signin`, `/ssb/signin_redirect` or `/ssb/add` and the sign-in method is native, the shell appends `aswebauth=1`, optionally rewrites to `/sso/saml/start?redir=...`, and starts `electron-native-auth`'s `AuthRequest({ url, callbackScheme: "slack", windowHandle })` (an `ASWebAuthenticationSession`). The callback `slack://...` URL is expected to be a magic-login link, which is then processed by the magic-login flow above. So native auth never yields a token directly; it yields a one-time link that becomes cookies.
- The session: Chromium cookie store `~/Library/Application Support/Slack/Cookies` (SQLite). For `.slack.com` the observed cookie names are `d` (Secure, HttpOnly, SameSite=Lax), `lc`, `b`, `ui`, `tz`, `ssb_instance_id`, `utm`; all values are in the `encrypted_value` column. Encryption is Chromium `os_crypt` with the keychain generic password service `"Slack Safe Storage"`, account `"Slack"` (metadata only; fuse `EnableCookieEncryption` is on). `electron.safeStorage` uses the same backend; main logs `safeStorage.getSelectedStorageBackend()` in diagnostics (`main:59329`).
- Cookie hardening in main:
  - `onHeadersReceived` on `https|wss://*.slack.com/*` rewrites `Set-Cookie` headers whose `SameSite` is not `Lax` to `SameSite=None` and replaces the value with `"__enc_ssb_cookie:" + hex(safeStorage.encryptString(value))`; `onBeforeSendHeaders` re-attaches and decrypts them into the `Cookie` header only for allowed origins/referrers (`main:45935`, `46060-46215`). This exists for the gov/mil "same-party" cookie case.
  - MAS build only: an `auth-cookie-backup` file in `userData` holding the `d` and `lc` cookies, encrypted with `safeStorage` and additionally AES-256-GCM under a PBKDF2 key derived from an instance id + app name; restored on boot if no `d` cookie exists (`main:50423-50510`). Not present on this (direct-download) install.
  - Dev only: `tsauth` cookies (`machine-cookie`, `slauth-session`, `tsa2`) from the environment for internal dev servers (`main:44405-44457`), and `https://auth.tinyspeck.com/slauth_login` (`main:59989`).
- "Toolbelt" OAuth tokens (an internal tool integration, redirect `slack://toolbelt-callback`): kept in memory and persisted only if `safeStorage.isEncryptionAvailable()` as `safeStorage.encryptString(JSON)` to a file (`main:59855-59880`, `66333-66350`).
- `xoxc`/`localConfig_v2`: the shell bundles contain **no** reference to `xoxc`, `xoxs`, `localConfig` or `TSSSB` (0 hits across all bundles). On disk, the web client's Local Storage for origin `https://app.slack.com` contains a key named `localConfig_v2` (key name observed via `strings`; value not read).
- Sign-out: main navigates to `/ssb/signout/<teamId>` (`main:61995`) and clears `serviceWorkers` and session data.

### Inferred

- `xoxc-` tokens are minted by the web client from the `d` cookie (the normal web-client bootstrap) and stored by the web client in `localConfig_v2`; the shell never sees or handles them. For Juno this means: having the `d` cookie in the right Chromium session is sufficient to boot the web client, and the shell layer does not need to touch tokens at all.
- The `lsp` localhost port and the `magic_login_uri` POST handler exist so that a browser-based SSO flow (sign-in in Safari) can hand the result back to the running app without relying only on the `slack://` scheme.

### Unknown

- Format of `localConfig_v2` and of the `d` cookie value (not inspected by design).
- Whether the `.slacktoken` document type is still used (no handler found in the bundles).

## 4. The bridge surface (`window.desktop`)

### Observed

- Exposure (`preload:32053-32070`): `contextBridge.exposeInMainWorld("desktop", {...})` and `exposeInMainWorld("process", {versions, mas, sandboxed})`; the same object is also assigned to `window.desktop` and `window.winssb` in the isolated world. A tiny `slackPlatform` ({isWayland}) is exposed first (`preload:34180`). The bridge is only built if the page is a Slack origin on https/443 or a shell `app://` page (`preload:31812-31820`). Child popups get only `slackPlatform`, `navigator.vibrate` override and a Cmd+= zoom hook (`child-preload:633-680`). Component windows get `desktop = { store, diagnostics, intl, <window-specific> }` (`component-preload:30360-30380`).
- Reverse direction: the web client registers callbacks with `desktop.setGlobalDelegate(obj)` and `desktop.exposeWorkspaceDelegate(workspaceId, obj)`; main pushes events with `webContents.send` and the preload calls delegate methods (`preload:31843-31890`): `handleDeepLinkWithArgs`, `openDialog`, `startSearch`, `closeCall`, `systemTextSettingsChanged`, `customMenuItemClicked`, `maybeTickleMS`, `onClosingChildWindows`, `focusNextWorkspace/PreviousWorkspace/setFocusedWorkspace`, `speedLimitChanged`, `queryStealthRestartSafe`; plus `RELOAD_DOCUMENT` and `SLEEP_AND_WAKE` (re-dispatched as a DOM event).
- Transport: every call is `ipcRenderer.invoke(channel, ...args)` (helper `eg.FW`) or `ipcRenderer.send` (`eg.JR`) with the string channel enum; main handles with `ipcMain.handle` wrapped in a joi validator (`oi(channel, handler)`, `main:65484` etc.) and checks `event.sender` (REA counted 4 sender-validation sites).
- Namespaces on `desktop` (`preload:31843-32070`): `window`, `accelerator`, `accessibility`, `app`, `calls`, `clipboard` (`writeString`, `writeImage`, `setAndPaste`), `contextMenu`, `contextMenus` (`create/remove` with click callbacks over `CONTEXT_MENU_CLICKED`), `diagnostics`, `dock` (`bounceOnce` → `SLACK_BOUNCE_DOCK "informational"`, `bounceIndefinitely` → `"critical"`), `downloads` (`showDownload`, `openDownload`, `retryDownload`, folder chooser), `localFileSearch`, `menus` (`extendMenu`, `extendWorkspaceMenu` → `EXTEND_MENU`), `notice` (notifications, below), `recentFiles`, `search` (Spotlight-style index add/remove), `screen` (`getAllDisplays`, `getCursorScreenPoint`, `getDisplayNearestPoint`), `spellCheckerV3`, `stats`, `teams`, `workspaces`, `redux` (`getState(path)`, `subscribe(path, cb)`, `dispatchUpdate` → `REDUX_UPDATE_FROM_WEBAPP`), `windowChrome` (debug-only), `callsScreenshare`, `system`.
- `desktop.window` (`preload:31476-31520`): `getWindowId`, `getMainWindowId`, `getIsInMainWindow`, `bringToForeground`, `callBrowserWindowMethod(id, method, ...args)` against an allowlist of `BrowserWindow` methods (`main:65000-65070`, includes `setVibrancy`, `setWindowButtonVisibility`, `setTitle`, `setSize`...), `addBrowserWindowEventListener(id, event, cb)` (main re-emits window events as `WINDOW_EVENT-<id>-<event>`), `subscribeToFrameStateChanges`, `setTitleBarOverlay`, `setWindowButtonPosition` (→ `BROWSER_WINDOW_SET_WINDOW_BUTTON_POSITION`, `main:65627`), `setImageAnimationPolicy`, `startWindowDrag/stopWindowDrag`, `openAuthenticatedInBrowser`.
- Window controls from the page: `send SET_FULL_SCREEN`, `TITLEBAR_DOUBLE_CLICK` (main reads `AppleActionOnDoubleClick` from `systemPreferences` and maximises/minimises accordingly, `main:59723-59735`), `MAXIMIZE_WINDOW`, `MINIMIZE_WINDOW`, `CLOSE_WINDOW`, `POPUP_APP_MENU`, `SET_WINDOW_FRAME`.
- Badge: the web client dispatches a redux action `SET_TASKBAR_BADGE` through `desktop.redux.dispatchUpdate`; main's `setBadgeEpic`/`TrayHandler` computes `{icon, tooltip, badge}` from unread counts and calls `app.dock.setBadge(text)` (`main:61181`), `"•"` for unreads without highlights, a number for highlights; Windows uses `setOverlayIcon`. Tray (`main:61231-61300`): `new Tray(nativeImage.createFromPath("resources/macos-menubar-icon-Template.png"))`, a template image, with a generated red-dot variant while recording; tray is behind a feature flag (`DESKTOP_COMMAND_CENTER`).
- Notifications (the path Juno cares about):
  1. Web client calls `desktop.notice.notify(payload)` (`preload:31203`) → `ipcRenderer.invoke("SLACK_NOTIFY", payload)`. Companion calls: `notice.shouldPlaySound()` (`SLACK_SHOULD_PLAY_SOUND`, main returns false when DND is on or playback is "system") and `notice.getNotificationWarnings()`.
  2. Main handler (`main:65484-65492`): checks notifications are allowed and DND is off (`macos-notification-state` addon, run via the `call-get-macos-notification-state-entry-point` child script so a native crash cannot take down main, `main:50318`), fills in an id (`<teamId>_<msg ts>`), normalises the payload (`pZ`, `main:60190-60225`: `title, subtitle, body, icon, teamId, userId, msg, channel, channelName, hasReply, silent, sound, groupId, mac:{closeButtonOverride, closeButtonText}`), and dispatches `NEW_NOTIFICATION`.
  3. Epic `NEW_NOTIFICATION` (`main:60210-60240`) does `new pY(options)` where `pY` wraps `new electron.Notification({ title, subtitle, body, icon, actions, hasReply, closeButtonText, sound, silent, urgency, groupId })` and `.show()` (`main:60096-60160`). A 5 s timer reports if the OS never fires `show`. Events `click`, `reply`, `action`, `close` are mapped back to redux actions `CLICK_NOTIFICATION` / `NOTIFICATION_ACTION` / `REMOVE_NOTIFICATION`, which the preload's own redux store observes (`preload:29018-29050`) and routes to the delegate.
  4. An alternative `notificationMethod: "html"` renders toasts in a shell-owned transparent, always-on-top, non-focusable `notifications` window loading `app://resources/notifications.html` (`main:60414-60445`), but a server feature flag (`FORCE_NATIVE_NOTIFICATIONS`) can force native, and the setting is reset to `null` on GPU-compositing problems (`main:59243`).
- Other bridge channels of note: `ASK_FOR_MEDIA_ACCESS`/`GET_MEDIA_ACCESS_STATUS` (camera/mic), `GET_SCREEN_PREVIEW_THUMBNAILS`, `POWER_SAVE_BLOCKER_*`, `ACCELERATOR_REGISTER_COMBO` (global shortcuts), `READ_SYSTEM_TEXT_PREFERENCES`, `VIBRATE_HAPTICS` (preload overrides `navigator.vibrate` to call `activateTouchpadHaptics`, `preload:31768-31790`), `SET_AND_PASTE_CLIPBOARD`, `PREPARE_AND_REVEAL_LOGS`, `GET_NETWORK_INFO`.

### Inferred

- The split into "web client → shell: `invoke`" and "shell → web client: delegate methods" (rather than event emitters on the bridge object) keeps the exposed object free of listeners and lets the web client version its own delegate. Channel-name enum + joi schema per channel is the contract.
- `window.desktop` is a fairly large object (30+ namespaces). Many are legacy; a new client needs a fraction.

### Unknown

- The exact payload type for `notify` beyond the normalised fields above (the web client side is not in scope).

## 5. Window chrome on macOS

### Observed

- Main window: `frame: false` on macOS, `titleBarStyle: "hidden"`, `titleBarOverlay: undefined` (`main:59447`, `59459-59465`). `trafficLightPosition` comes from a user setting (joi default `{x:14, y:22}`, each clamped to 0..40; `main:56369`, `52247-52252`) and is applied as `{x, y: floor(y/2)}`, so the default is `{x:14, y:11}` (`main:59468-59471`). The page can later move the buttons with `desktop.window.setWindowButtonPosition(id, {x,y}|null)` and can call `setWindowButtonVisibility` through `callBrowserWindowMethod`.
- Vibrancy: only when the `windowVibrancy` setting is on (default `false`, `main:58295`): `vibrancy: "titlebar"`, and in that case `backgroundColor` is left undefined; otherwise `backgroundColor` is derived from the user theme (`main:52285-52302`). Windows 22621+ uses `backgroundMaterial: "acrylic"` + `transparent`. `nativeTheme.on("updated")` tracks `prefersReducedTransparency` and the app disables vibrancy accordingly (`main:66364-66370`). Window state exposes `hasVibrancy` to the web client (`main:52430`).
- Drag regions: the shell does not inject any drag region into the web client; the web client's own top bar is the drag region (CSS `-webkit-app-region` is only present in the shell's own `unreachable-webdata` error page, a fixed 24 px `#titlebar` strip, `preload:20812`). The preload also provides `startWindowDrag/stopWindowDrag` IPC for custom drag handling and an opt-in `<window-chrome>` custom element (inlined bundle, `preload:26207`, `window-chrome.less`) that renders a Windows/Linux title bar with an app-menu button; it is only injected when `debugFeatures` includes `window-chrome` or on non-mac platforms (`preload:34226`). Theme colours for it default to `titlebarBackground: "#232323"`, `titlebarTextColor: "#FFFFFF"` (`main:51869`).
- Double-click on the title area: web client sends `TITLEBAR_DOUBLE_CLICK`, main honours the macOS `AppleActionOnDoubleClick` preference (`Maximize` default / `Minimize` / `None`).
- Component windows: on macOS a window that sets neither `frame` nor `titleBarStyle` (about box, basic-auth) gets `titleBarStyle: "hiddenInset"`; windows that explicitly ask for `titleBarStyle: "default"` (settings editor, net-log) and all non-mac windows instead get 24 px added to their height for the title bar (`main:52213`, `52230`, `52275-52278`). The HTML notifications window is `frame: false, transparent: true, alwaysOnTop, skipTaskbar, focusable: false` (`main:60418-60430`).
- Fullscreen: `fullscreenable: true`; the debug `<window-chrome>` element maps an `exitfullscreen` event to `SET_FULL_SCREEN false` (`preload:32028-32033`); closing the main window while fullscreen first leaves fullscreen, then hides (`main:59760-59765`). Close hides the window rather than quitting when run from the tray.
- `Info.plist`: `NSRequiresAquaSystemAppearance: false` (dark mode supported), `NSHighResolutionCapable`, `LSMinimumSystemVersion 13.0`, `NSPrincipalClass AtomApplication`, `NSUserActivityTypes com.tinyspeck.chatlyio.view-canvas` (Handoff to the iOS app for canvases).

### Inferred

- `y: floor(22/2) = 11` plus `x: 14` puts the traffic lights vertically centred in a 44 px top bar, which matches the height of Slack's web-client top bar. The halving suggests the setting was originally expressed for a different (2x) coordinate convention and kept for compatibility.

### Unknown

- Whether Slack sets `setWindowButtonPosition` at runtime from the web client in normal use (the API exists; the caller is in the web client).

## 6. Other things worth copying for a macOS Electron client

### Observed

- Security
  - Every window goes through one factory that force-merges `{nodeIntegration:false, nodeIntegrationInWorker:false, nodeIntegrationInSubFrames:false, contextIsolation:true, sandbox:true, webviewTag:false, autoplayPolicy:"no-user-gesture-required"}` and logs an error if a caller tries to override any of them (`main:44052-44072`).
  - `app.enableSandbox()` plus an `app.on("browser-window-created")` watchdog that reads `getLastWebPreferences()` and destroys any window with `sandbox:false` or `contextIsolation:false` (`main:66212-66225`).
  - Fuses (read with `@electron/fuses`): `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableCookieEncryption` on, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `GrantFileProtocolExtraPrivileges` off. `Info.plist` carries `ElectronAsarIntegrity` (SHA256 of `app.asar`).
  - Entitlements: `allow-jit`, audio-input, camera, bluetooth, print, usb, location, photos-library (hardened runtime; no `disable-library-validation`). Not MAS-sandboxed in this build (`process.mas` paths exist for the App Store variant).
  - Shell HTML pages ship a strict CSP meta tag with a `sha384` script hash and SRI on the script tag: `base-uri 'self'; object-src 'none'; script-src 'sha384-...'; style-src 'self' 'unsafe-inline'; default-src 'self' https://app.slack.com/ app://*; img-src 'self' https://*.slack-edge.com https://slack-imgs.com/ app://*; frame-src 'none'` (`dist/settings-editor.html`, `basic-auth-view.html`; produced by the patched `csp-rspack-plugin`).
  - Permission handlers on both sessions; `certificate-error` is logged with fingerprint/issuer and surfaced once per host (`main:66093-66110`).
  - Only `https`/`wss` to allowlisted Slack domains are navigable; everything else is `shell.openExternal`.
- Auto-update (`main:66645-66790`, class `MacUpdater`): Electron's built-in `autoUpdater` (Squirrel.Mac, `Squirrel.framework` is in `Contents/Frameworks`). Feed URL is `<updateUrl>?platform=darwin&os_version=&app_version=&channel=<prod|beta|alpha>`. Two modes: `checkForUpdatesDirect` (fetch JSON, `setFeedURL`, `checkForUpdates`) and `checkForUpdatesThroughLocalServer`, which downloads the zip itself (with credentials when behind a proxy), then spins a `127.0.0.1` HTTP server serving `/json` and `/download` (or a `file://` path) so Squirrel can consume it. Before installing it checks write permission on `Slack.app` and `~/Library/Caches/com.tinyspeck.slackmacgap.ShipIt` and shows a dialog if an admin prompt is expected. `quitAndInstall` with an `error` fallback to plain relaunch (`main:50833-50845`). Release channel override lives in `local-settings.json`.
- Crash/diagnostics: `@sentry/electron` with per-bundle debug ids, `crashReporter` registered early (`REGISTER_CRASH_REPORTER`), `chrome://gpu` and `chrome://tracing` capture windows, a net-log window, and a "settings editor" window for support.
- Chromium switches: `disable-pinch`, `disable-renderer-backgrounding`, optional `ignore-connections-limit`, `enable-logging=stderr`, `log-file`, `remote-debugging-port=8315` in dev (`main:66470-66489`). Blink features `ExperimentalJSProfiler` enabled (`main:66427`). `LSEnvironment MallocNanoZone=0` in `Info.plist`.
- Protocol handlers: `slack` URL scheme + `LSApplicationQueriesSchemes slack`, `app://` for local pages, `slack-webapp-dev` privileged scheme in dev (`main:41717`, `66064-66073`).
- Child-process isolation for native addons: `macos-notification-state` and `media-access-status` are called in a forked script (`call-get-*-entry-point.bundle.cjs`) rather than in main.
- App data layout: everything under `~/Library/Application Support/Slack` (Chromium profile + `storage/root-state.json` + `local-settings.json` + `logs/` + `sentry/`), `userData` renamed per environment (`SlackDevEnv`, `SlackDevMode`) so dev and prod never share cookies.
- Haptics and text prefs: `activateTouchpadHaptics` via `navigator.vibrate` shim; `READ_SYSTEM_TEXT_PREFERENCES` and `TEXT_PREFERENCES_CHANGED` for macOS text settings; `systemPreferences.subscribeNotification` for system events (`main:60887`).

### Inferred

- Electron Forge is used for packaging (makers dmg/zip) but the actual signing/notarising is driven by Slack's own `build/cli/codesign.ts`. The `appdmg` optional dependency builds the DMG.
- The shell sets `Menu.setApplicationMenu(null)` first (`main:59435`) and rebuilds the menu from the web client's `EXTEND_MENU` payloads, so the app menu content is owned by the web client.

### Unknown

- The update server URL (constant resolved at runtime; not inspected further) and whether staged rollouts are server-side.

## What Juno should copy / avoid

Copy

- One shared package for the shell contract: channel-name enum, payload types, validators (zod/joi), exported for both main and preload. Slack validates every IPC payload in main; do the same.
- One window factory that force-merges secure `webPreferences` and a `browser-window-created` watchdog that kills windows with weaker settings. Add `app.enableSandbox()`, fuses (`RunAsNode` off, asar integrity on, `OnlyLoadAppFromAsar`), and a hashed CSP on any local HTML.
- A custom privileged scheme (`juno://`) for local pages with the same path-traversal guard, instead of `file://`.
- `titleBarStyle: "hidden"` + `trafficLightPosition` around `{x:14, y:11}` for a 44 px top bar, `frame: false` only on macOS, drag regions drawn in the React UI, and `TITLEBAR_DOUBLE_CLICK` honouring `AppleActionOnDoubleClick`. Keep vibrancy opt-in and respect `prefersReducedTransparency`.
- Native `electron.Notification` from main with a `show`/`failed` timeout and a DND check before showing; map `click`/`reply`/`action` back into app actions. Skip HTML toasts.
- `app.dock.setBadge` with soft text (`•` vs count) decided in main from app state; a template-image `Tray` only if actually needed.
- Keep the Slack session in a Chromium session (cookies encrypted by the OS keychain) and never move tokens into app files. If Juno needs the `d` cookie for its own API calls, read it through `session.cookies.get` in main and keep it in memory.
- Handle `slack://` deep links through `setAsDefaultProtocolClient` + `open-url` + single-instance lock, queue until ready.
- Use the Chromium spellchecker (`spellcheck: true`) with `replaceMisspelling` in a context menu.
- Run fragile native addons in a child process.
- Distinct `userData` names per environment (`Juno`, `JunoDev`).
- Squirrel.Mac `autoUpdater` with a JSON feed and a pre-install permission check; handle `error` by relaunching.

Avoid

- Loading the whole product as a remote document on `defaultSession` with a 30-namespace bridge. Juno owns its UI, so keep the bridge small and use a named `persist:` partition for Slack web resources if any are embedded.
- The delegate-object pattern (`setGlobalDelegate`) if Juno's renderer and main are built together; typed `ipcRenderer.on` subscriptions via `contextBridge` are simpler.
- SameSite cookie rewriting via `webRequest` header surgery, MAS cookie-backup sidecars, and the localhost update/login servers; these solve Slack-specific constraints (gov/mil, App Store, SSO hand-back) that Juno does not have.
- A hidden `BrowserWindow` per download; use `session.downloadURL` or `net.fetch` in main.
