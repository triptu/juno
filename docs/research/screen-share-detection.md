# Detecting screen sharing on macOS

Can Juno turn privacy mode (SPEC section 5) on by itself when the screen is shared or recorded? This is what we found on 2026-10-15. Nothing here is built. Claims are marked **verified** (we ran it, or read the source) or **unverified**.

## Short answer

There is no public API that tells an app that another app is capturing the screen. Apple DTS says so ([forum 667549](https://developer.apple.com/forums/thread/667549)). The working answer, used by several shipping apps, is a private window-server call:

```c
bool CGSIsScreenWatcherPresent(void);   // CoreGraphics
bool SLSIsScreenWatcherPresent(void);   // SkyLight, the same call
```

It is true while any process holds a screen capture stream. Change notifications come through `CGSRegisterNotifyProc` with event 1502 (watcher added) and 1503 (watcher removed).

## What we know

- **Verified on this Mac (macOS 26.6.2, build 25G83).** A Swift probe found `CGSIsScreenWatcherPresent` and `CGSRegisterNotifyProc` in CoreGraphics, and `SLSIsScreenWatcherPresent`, `SLSRegisterNotifyProc` and the `CGS` names in SkyLight, by `dlsym`. The call returned a value, and registering for 1502 and 1503 returned success.
- **Not verified yet.** That the value flips from false to true when a Zoom, Meet or QuickTime share starts and back when it stops, and that the 1502 and 1503 callbacks fire. The probe ran while something was already capturing, so it only saw `true`. This is the first thing to check by hand before building.
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

## Proposed design

1. **Main owns it.** A small `ScreenWatch` service in the main process (Effect, like the other main services) polls `SLSIsScreenWatcherPresent` every 2 s while a window is open, falling back to the `CGS` name, and turns itself off for good if neither symbol resolves. One window-server call per poll; no measurable cost.
2. **The call.** Through [koffi](https://koffi.dev), which loads a framework and calls a C function from JavaScript: `koffi.load('/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight').func('bool SLSIsScreenWatcherPresent()')`. No Swift, no helper process. Polling avoids calling back into JavaScript from the window server's thread, which is where a koffi callback could go wrong; the 1502 and 1503 notifications are an optimisation we can skip.
3. **Behaviour.** A new Preferences row, "Hide message text while sharing the screen", on by default once it ships. When the signal goes from false to true, main turns privacy mode on, as ⌃⌘H does, and remembers that it did. When the signal goes back to false, main turns the mode off only if it turned it on and the user has not touched it since. It never turns off a mode the user turned on. Because the signal can be true with nobody watching, the footer then reads "Message text hidden while sharing" so the cause is clear, and Show still turns it off for this share.
4. **Renderer.** Nothing new: it already follows `privacyAtom`. Main sends the change the same way as a menu command.
5. **Tests.** A test seam replaces the probe under `JUNO_E2E`, so an e2e test can say "sharing started" and check the blur and the footer. One manual check per macOS release with a real Zoom or Meet share.

### Shipping and signing

- **koffi (recommended).** One npm dependency with prebuilt Node-API binaries for darwin arm64 and x64, so no rebuild per Electron version (unverified: confirm against our Electron before adopting). Its `.node` file is signed with the app like any native module; electron-builder already does this. It must be unpacked from the asar (`asarUnpack`). Cost: about a day including the Preferences row and tests, plus a few hundred KB in the app bundle. It is a native module in main, so it needs an ADR and an entry in `check-deps`.
- **A Swift helper (fallback).** A 50-line command-line tool that prints `on` and `off` to stdout, using the 1502 and 1503 notifications on its own run loop. Built universal (`swiftc` for arm64 and x86_64, then `lipo`), shipped in `Contents/MacOS`, signed with our Developer ID and hardened runtime, and notarized with the app. Cost: a Swift build step in CI, a child process to start and restart, and about two days. Choose this only if koffi does not load in our signed build.
- **A Node-API addon in Objective-C.** The most build work for no gain over the two above.
- **Private API risk.** Not an App Store app, so no review issue. Notarization does not scan for private symbols (unverified, but the open-source apps above are notarized). If Apple removes the symbol, auto-detect stops and the manual mode keeps working.

## Next step

Check by hand that the value flips with a real share. Run this with `swift probe.swift` before, during and after a Zoom or Meet share, and during a QuickTime screen recording. If it flips, build the design above.

```swift
import Foundation
let skylight = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW)
typealias Present = @convention(c) () -> Bool
let present = unsafeBitCast(dlsym(skylight, "SLSIsScreenWatcherPresent"), to: Present.self)
print(present())
```
