# 0015. Call the window server through koffi to tell when the screen is shared

Status: accepted, 2026-10-16. Built in `apps/desktop/src/main/screenWatch.ts`.

## Context

Privacy mode (SPEC section 5) hides message text so it cannot be read over a shared screen. The owner asked for it to turn on by itself when sharing starts. macOS has no public API for "another app is capturing the screen". The research (`docs/research/screen-share-detection.md`) found one private call that shipping apps use: `SLSIsScreenWatcherPresent` in SkyLight, also exported as `CGSIsScreenWatcherPresent` from CoreGraphics. It takes no arguments and returns a bool. Main runs Node, which cannot call a C function without a native module.

## Decision

- Add [koffi](https://koffi.dev) 3.3.3, a Node-API FFI module, as a runtime dependency of `@juno/desktop`. Main loads it lazily, after the app window's first paint, and calls `bool SLSIsScreenWatcherPresent()`, falling back to the `CGS` name. If koffi does not load or neither name resolves, the screen watch turns itself off for the rest of the run and Settings says it is not available. Hiding by hand keeps working.
- Poll every 2 s while the app window is open. The window server's change notifications (1502 and 1503) would call back into JavaScript from another thread; polling avoids that, and one call every 2 s costs nothing measurable.
- koffi is imported only from `screenWatch.ts` (`scripts/check-deps.mjs`, the `thirdParty` list).
- Packaging: koffi's binary comes from its `@koromix/koffi-<platform>` optional dependency, so its install script, which only checks the binary or rebuilds it with CMake, is denied in `pnpm-workspace.yaml`. Node-API means no rebuild per Electron version. `electron-builder.yml` already unpacks `**/*.node` and `**/koffi/**` from the asar; it now also leaves out koffi's C++ sources and docs. The packaged smoke test checks that the symbol resolves in the packaged, signed app.
- Under `JUNO_E2E` a seam replaces the probe (`junoTest.screenShared`), so e2e tests never call the window server and run on Linux.

## Consequences

- The call is private. A macOS update could remove it; the result is that automatic hiding stops, not a crash. Check it with a real Zoom or Meet share once per macOS release.
- The signal says that something captures, not who. A screenshot tool, a screen recorder or an always-on screen-context app counts too. On the owner's Mac the signal was already true before any test capture (research doc, "Probe on 10-16"). So the footer says "Message text hidden while sharing" and Show turns it off until the next share starts.
- About 1.3 MB more in the app, all unpacked from the asar: the arm64 `.node` (1.2 MB) and koffi's JS (84 KB), measured in the packaged build on 10-16.

## Alternatives

- **A Swift helper process** that prints on and off from the notifications. More build work (a Swift step, universal binary, signing a second executable) and a child process to supervise. Kept as the fallback if koffi stops loading in the signed build.
- **A Node-API addon in Objective-C.** The most build work, for the same single call.
- **`setContentProtection(true)`.** Hides the window instead of detecting sharing, is not honoured by ScreenCaptureKit on macOS 15 and later, and would blank the window in the user's own screenshots.
