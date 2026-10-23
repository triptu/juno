# 0018: UI tests run in a browser against an engine host

Date: 2026-10-24
Status: Accepted

Most desktop tests exercise the renderer, engine and Slack boundary. Starting Electron for each flow also starts main, the engine utility process and the agent utility process, even when the test needs none of their native integration.

Run these flows in Playwright's Chromium headless shell against the production renderer build and a Node engine host. Each worker owns a browser and a spare loaded host process; each test owns a fresh context, host, data directory and fake Slack. The fake stays in the Playwright worker so scenarios can control its boundary directly. A synced snapshot uses origin aliases so each fake can listen on its own free port.

The shared driver has browser and Electron surfaces. Native menus and operating-system APIs remain Electron tests; browser tests drive equivalent page commands and recording boundary fakes. Tags keep native cases in Electron and canary flows in both. Relaunch stops and restarts the real engine on the same data directory.

Keep zero retries, traces only on request, and coverage only when requested. Record per-test durations for planning and measurement. The browser lane does not establish Electron startup, CPU or native interaction performance budgets.

Bun.WebView was rejected because its macOS backend is WebKit and its Chrome backend shares storage. Playwright contexts provide isolated Chromium storage without starting a full desktop app per test. The host remains on Node because the store's SQLite driver requires extension loading.
