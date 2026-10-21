# 0001. Run the engine in a utility process, not in main

Status: accepted, 2026-10-12. Revised in v2: network access is described in ADR 0007.

## Context

All business logic and I/O (Slack HTTP and websocket, sync, SQLite, AI, notifications) must live outside the renderer so secrets never reach it. The draft put this "engine" in the Electron main process, which is the simplest option: Electron APIs are at hand and IPC is `ipcMain.handle` plus `webContents.send`.

Two facts argue against main. `node:sqlite` is synchronous, so bulk writes at boot and large queries block the thread they run on; `client.userBoot` can be megabytes of JSON. In main, those stalls freeze native menus, window dragging and every IPC round trip. A bug in the engine (a runaway sync loop, an unhandled rejection) would take the window with it.

## Decision

The engine is a plain Node program (`@juno/engine`, `startEngine(transport, config)`) that Electron runs in a `utilityProcess` forked with `partition: 'persist:slack'` (see ADR 0007). Main stays a thin shell: windows, menus, notifications, dock badge, `safeStorage`, the Slack session, import from the installed Slack app, the `juno://` scheme, and supervision of the engine process.

Main creates a `MessageChannelMain` and gives one port to the utility process and the other to the renderer (forwarded by the preload with `window.postMessage`). Renderer and engine talk directly; main is not in the data path. The token is decrypted in main and sent to the engine over `parentPort` at start; the engine keeps it in memory only.

Lifecycle: main restarts the engine on exit with backoff and a crash-loop cap. The renderer's `MessagePort` fires `close` when the engine dies; it asks main for a new port and re-subscribes. The engine accepts several ports and drops a port's subscriptions when it closes.

The engine depends only on a MessagePort-shaped `Transport` and an `HttpTransport` service, so it can also be hosted in main or started under plain Node for tests without changing any package.

## Consequences

- Engine tests run under Node against `fake-slack` with no Electron launch.
- The engine cannot use Electron's window, notification or protocol APIs (custom protocols are unsupported in utility processes), which keeps shell concerns out of it. It can use `net`, which ADR 0007 relies on.
- Three contracts (renderer↔engine, renderer↔main, engine↔main), all in `@juno/contract`.
- Playwright's `electronApp.evaluate` cannot reach the engine; e2e goes through the UI, the fake server, and main-side recording hooks (notifications, menus, clock).
