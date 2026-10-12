# 0001. Run the engine in a utility process, not in main

Status: proposed, 2026-10-12

## Context

All business logic and I/O (Slack HTTP and websocket, sync, SQLite, AI, notifications) must live outside the renderer so secrets never reach it. The draft put this "engine" in the Electron main process, which is the simplest option: Electron APIs are at hand and IPC is `ipcMain.handle` plus `webContents.send`.

Two facts argue against main. `node:sqlite` is synchronous, so bulk writes at boot and large queries block the thread they run on; `client.userBoot` can be megabytes of JSON. In main, those stalls freeze native menus, window dragging and every IPC round trip. Also, a bug in the engine (a runaway sync loop, an unhandled rejection) would take the window with it.

## Decision

The engine is a plain Node program (`@juno/engine`, `startEngine(transport, config)`) that Electron runs in a `utilityProcess`. Main stays a thin shell: windows, menus, notifications, dock badge, `safeStorage`, sign-in window, import from the installed Slack app, and supervision of the engine process.

Main creates a `MessageChannelMain` and gives one port to the utility process and the other to the renderer (forwarded by the preload with `window.postMessage`). Renderer and engine then talk directly; main is not in the data path. Secrets are decrypted in main and sent to the engine over `parentPort` at start; the engine keeps them in memory only. Notifications and the badge go engine → main over the same channel.

The engine depends only on a MessagePort-shaped `Transport` interface, so it can also be hosted in main or started under plain Node for tests without changing any package.

## Consequences

- Engine tests run under Node against `fake-slack` with no Electron launch.
- The engine cannot use Electron APIs, which keeps shell concerns out of it by construction. HTTP uses Node `fetch`; the socket uses `ws` because the browser `WebSocket` cannot set the `Cookie` and `User-Agent` headers.
- Three contracts instead of one (renderer↔engine, renderer↔main, engine↔main), all in `@juno/contract`.
- Main must restart the engine on crash and the renderer must reconnect with a fresh port; `engine.status` exposes this.
- Playwright's `electronApp.evaluate` cannot reach the engine; e2e goes through the UI and the fake server, which is what we want anyway.
