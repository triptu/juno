# 0018: UI tests run in a browser against an engine host

Date: 2026-10-24
Status: Accepted

Most desktop tests exercise the renderer, engine and Slack boundary. Starting Electron for each flow also starts main, the engine utility process and the agent utility process, even when the test needs none of their native integration.

Run these flows in Playwright's Chromium headless shell against the production renderer build and a Node engine host. Each worker owns a browser context and loaded host processes. Each test owns a fresh page, engine, agent, shell services, data directory and fake Slack. Teardown clears origin storage, cookies, permissions and network state before the next page; only immutable HTTP assets stay cached. Hosts return to the pool after their services and sockets stop, and failed cleanup discards them. Coverage keeps a process per test. The fake stays in the Playwright worker so scenarios can control its boundary directly. A synced snapshot uses origin aliases so each fake can listen on its own free port.

The shared driver has browser and Electron surfaces. Native menus and operating-system APIs remain Electron tests; browser tests drive equivalent page commands and recording boundary fakes. Tags keep native cases in Electron and canary flows in both. Relaunch stops and restarts the real agent and engine on the same data directory. The host uses main’s provider store and agent configuration, memory credential boundaries, an agent WebSocket carrying the worker protocol, and the real QuickJS worker and wasm. Native folder selection and process crash supervision remain Electron checks.

Keep zero retries, traces only on request, and coverage only when requested. Record per-test durations for planning and measurement. The browser lane does not establish Electron startup, CPU or native interaction performance budgets.

Bun.WebView was rejected because its macOS backend is WebKit and its Chrome backend shares storage. Playwright provides explicit Chromium storage reset and fresh pages without starting a full desktop app per test. The host remains on Node because the store's SQLite driver requires extension loading.
