# Detecting screen sharing on macOS

Can Juno turn privacy mode (SPEC section 5) on by itself when the screen is shared or recorded? This is what we found on 2026-10-15, and the probe run on 2026-10-16 before building it. The design below was built on 2026-10-16 (`apps/desktop/src/main/screenWatch.ts`, ADR 0015). Claims are marked **verified** (we ran it, or read the source) or **unverified**.

## Short answer

There is no public API that tells an app that another app is capturing the screen. Apple DTS says so ([forum 667549](https://developer.apple.com/forums/thread/667549)). The working answer, used by several shipping apps, is a private window-server call:

```c
bool CGSIsScreenWatcherPresent(void);   // CoreGraphics
bool SLSIsScreenWatcherPresent(void);   // SkyLight, the same call
```

It is true while any process holds a screen capture stream. Change notifications come through `CGSRegisterNotifyProc` with event 1502 (watcher added) and 1503 (watcher removed).

## What we know

- **Verified on this Mac (macOS 26.6.2, build 25G83).** A Swift probe found `CGSIsScreenWatcherPresent` and `CGSRegisterNotifyProc` in CoreGraphics, and `SLSIsScreenWatcherPresent`, `SLSRegisterNotifyProc` and the `CGS` names in SkyLight, by `dlsym`. The call returned a value, and registering for 1502 and 1503 returned success.
- **Still not verified.** That the value flips from false to true when a Zoom, Meet or QuickTime share starts and back when it stops, and that the 1502 and 1503 callbacks fire. Both probes (10-15 and 10-16, below) ran while another process was already capturing, so they only saw `true`. Check it on a Mac with nothing capturing.
- **Verified from source.** On Mac Catalyst, `UIScreen.isCaptured` is built on `CGSIsScreenWatcherPresent`, and UIKit listens for 1502 and 1503 (MacPaw, [Is Mac screen captured?](https://macpaw.tech/research/is-mac-screen-captured), 2021). WebKit's `CoreGraphicsSPI.h` declares the same two events.
- **Verified from source, macOS 15 and 26.** Current open-source apps use it: [openusage `ScreenCaptureProbe.swift`](https://github.com/robinebers/openusage/blob/main/Sources/OpenUsage/Services/ScreenCaptureProbe.swift) (July 2026, a "Hide from screen share" feature: `SLS` first, then `CGS`, polling as the guarantee and the notifications for speed) and [Atoll `ScreenRecordingManager.swift`](https://github.com/Ebullioscopic/Atoll/blob/main/DynamicIsland/managers/ScreenRecordingManager.swift) (August 2026). We found no report of it breaking on 15 or 26. SkyLight's SDK stubs have exported the symbol since 10.12.
- **Unverified.** That Raycast uses this call. The [Reddit thread](https://www.reddit.com/r/swift/comments/1jysl8g/how_does_raycast_detect_that_screen_sharing_is/) has no answer from Raycast; one reply points at `CGSIsScreenWatcherPresent`, another at the MacPaw article.
- **Unverified.** That macOS's own "Allow notifications when mirroring or sharing the display" setting uses the same signal.

### Limits of the signal

- It says that something captures, not what. Screenshot tools, always-on screen-context apps, a screen recorder left running, and Juno's own `desktopCapturer` would all count. So it can be true when nobody watches.
- It cannot tell a call from a recording, or which display.
- It is private, so a macOS update could remove it. It is resolved at run time, so the result would be "the feature stops working", not a crash.

### What does not work

| Option | Why not |
| --- | --- |
| ScreenCaptureKit, `SCShareableContent` | Lists what this app could capture, not who is capturing. |
| `CGPreflightScreenCaptureAccess` | This app's own permission only. |
| `UIScreen.isCaptured` | iOS and Catalyst only. |
| `NSWindow.hasActiveWindowSharingSession` | SharePlay window sharing only (macOS 13.3+). |
| `BrowserWindow.setContentProtection(true)` (`sharingType = .none`) | Hides the window instead of detecting. ScreenCaptureKit, which Zoom and browsers use on macOS 15+, does not reliably honour it ([forum 808016](https://developer.apple.com/forums/thread/808016)). It would also blank the window for the user's own screenshots. |
| Control Center's `AudioVideoModule` window in `CGWindowListCopyWindowInfo` | Also lights for the camera or microphone alone, and reading other apps' window names needs Screen Recording permission. |
| `CGSessionCopyCurrentDictionary()["CGSSessionScreenIsShared"]` | macOS Screen Sharing and remote sessions only. A fallback at most. |
| Process list (`screencapture`, zoom.us) | Misses browser calls such as Meet. |

## Probe on 10-16

Before building, a Swift probe (compiled with `swiftc -O`) read `SLSIsScreenWatcherPresent` and `CGSIsScreenWatcherPresent` every 500 ms for 12 s, while `screencapture -v -V 5` made a 5 s screen recording from 3 s to about 8 s. macOS 26.6.2 (25G83), run from the agent's terminal.

- **Permission.** Not blocked: the terminal already had Screen Recording permission, and the recording was written (3.2 MB). It was deleted afterwards.
- **Result: no flip seen.** Both calls returned `true` in all 24 samples: before the recording, during it and after it. Something on this Mac holds a capture stream all the time (an always-on screen-context app, a recorder or a screenshot tool; the call cannot say which). So the run shows that the calls answer and agree, not that they change.
- **What this means for the design.** Nothing changes: it polls, and it does not depend on a flip being seen at a particular moment. But on a Mac like this one the signal is always true, so Juno hides message text at every launch until the user presses Show, and never shows it again by itself while that app runs. The footer says why ("Message text hidden while sharing"), and the Settings switch turns the behaviour off. The flip still needs checking by hand on a Mac with nothing capturing, with a real Zoom or Meet share.

The same check from Electron 44 through koffi 3.3.3, in main: `SLSIsScreenWatcherPresent` and `CGSIsScreenWatcherPresent` both resolve and return `true`, and a missing name throws "Cannot find function", which is what the fallback needs (**verified**, 10-16).

## Design (built 10-16)

1. **Main owns it.** A small screen watch in the main process (`screenWatch.ts`, a plain module like main's other services; main uses Effect only for `Schema`) polls `SLSIsScreenWatcherPresent` every 2 s while a window is open, falling back to the `CGS` name, and turns itself off for good if neither symbol resolves. One window-server call per poll; no measurable cost.
2. **The call.** Through [koffi](https://koffi.dev), which loads a framework and calls a C function from JavaScript: `koffi.load('/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight').func('bool SLSIsScreenWatcherPresent()')`. No Swift, no helper process. Polling avoids calling back into JavaScript from the window server's thread, which is where a koffi callback could go wrong; the 1502 and 1503 notifications are an optimisation we can skip.
3. **Behaviour.** A Settings › General row, "Hide message text while sharing the screen", on by default, saved in `launch.json` (`hideWhileSharing`). When the signal goes from false to true, main turns privacy mode on, as ⌃⌘H does, and remembers that it did. When the signal goes back to false, main turns the mode off only if it turned it on and the user has not touched it since. It never turns off a mode the user turned on. Because the signal can be true with nobody watching, the footer then reads "Message text hidden while sharing" so the cause is clear, and Show still turns it off for this share. As built:
   - The first reading counts from false, so a share already running when Juno opens hides the text.
   - Whether sharing turned the mode on is saved with it (`privacyBySharing` in `launch.json`), so after a relaunch mid-share the mode still turns off when the share ends, and a share that ended while Juno was closed turns it off at the first reading.
   - Any toggle by the user (⌃⌘H, the avatar menu, Show) ends sharing's claim.
   - The poll starts after the app window's first paint, so loading koffi never delays it, and stops when the window closes.
4. **Renderer.** Main saves the change and sends `privacy.changed` with `{ privacy, sharing }`; the renderer sets `privacyAtom` and `privacySharingAtom` without sending it back. The page's `?privacy=sharing` gives the first frame the right footer after a relaunch.
5. **Tests.** A test seam replaces the probe under `JUNO_E2E` (`junoTest.screenShared`), so `e2e/privacy-sharing.spec.ts` says "sharing started" and checks the blur and the footer. The packaged smoke test loads the real probe from the asar (`JUNO_E2E_SCREEN_PROBE=1`) and checks that the SkyLight name resolves. One manual check per macOS release with a real Zoom or Meet share.

### Shipping and signing

- **koffi (chosen, ADR 0015).** One npm dependency with prebuilt Node-API binaries for darwin arm64 and x64, so no rebuild per Electron version (verified: koffi 3.3.3 loads in Electron 44.7.0, Node-API 10). The binary comes from the `@koromix/koffi-darwin-arm64` optional dependency; koffi's install script, which only checks it or rebuilds with CMake, is denied in `pnpm-workspace.yaml`. Its `.node` file is signed with the app like any native module; electron-builder already does this. It must be unpacked from the asar (`asarUnpack`). Cost: about a day including the Preferences row and tests, plus a few hundred KB in the app bundle. It is a native module in main, so it needs an ADR and an entry in `check-deps`.
- **A Swift helper (fallback).** A 50-line command-line tool that prints `on` and `off` to stdout, using the 1502 and 1503 notifications on its own run loop. Built universal (`swiftc` for arm64 and x86_64, then `lipo`), shipped in `Contents/MacOS`, signed with our Developer ID and hardened runtime, and notarized with the app. Cost: a Swift build step in CI, a child process to start and restart, and about two days. Choose this only if koffi does not load in our signed build.
- **A Node-API addon in Objective-C.** The most build work for no gain over the two above.
- **Private API risk.** Not an App Store app, so no review issue. Notarization does not scan for private symbols (unverified, but the open-source apps above are notarized). If Apple removes the symbol, auto-detect stops and the manual mode keeps working.

## Next step

Check by hand that the value flips with a real share, on a Mac where nothing else captures (quit screen recorders, screenshot tools and screen-context apps first, and check that the probe prints `false`). Run the probe before, during and after a Zoom or Meet share, and during a QuickTime screen recording. Then open Juno and share: the text should hide within 2 s and show again within 2 s of the share ending. The probe used on 10-16, built with `swiftc -O probe.swift -o probe` and run as `./probe 12` (seconds):

```swift
import Foundation
let sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW)
let cg = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_NOW)
typealias Present = @convention(c) () -> Bool
let sls = unsafeBitCast(dlsym(sky, "SLSIsScreenWatcherPresent"), to: Present.self)
let cgs = unsafeBitCast(dlsym(cg, "CGSIsScreenWatcherPresent"), to: Present.self)
let seconds = Double(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "14")!
let start = Date()
setvbuf(stdout, nil, _IOLBF, 0)
while Date().timeIntervalSince(start) < seconds {
  print(String(format: "%.1f SLS=%d CGS=%d", Date().timeIntervalSince(start), sls() ? 1 : 0, cgs() ? 1 : 0))
  usleep(500_000)
}
```
