# Packaging audit

Measured on macOS Apple Silicon, 2026-10-15. The baseline is the existing
artifact from `ecc40842`; the replacement is built by `pnpm package`.
File sizes below count regular files once, without following framework symlinks.
Allocated sizes use `stat.blocks * 512`, so they can vary across filesystems.

The app fell from 750.8 MiB allocated to 292.2 MiB (61.1% smaller). Logical file bytes fell from 786,268,312 to 305,511,143. The earlier 756 MiB report used a different measurement; this comparison uses the same traversal for both artifacts.

The main causes were unused Codex vendor executables (about 323 MiB) and
unbundled copies of libraries already included in the Vite output. Source maps
accounted for another 30.4 MiB inside the old asar. There was one ARM64 Electron
framework, not duplicate architectures or frameworks.

The desktop manifest now distinguishes build inputs from external runtime
dependencies. Vite bundles application code; electron-builder copies only
`electron-updater` and its dependencies. A build check rejects undeclared bare
runtime imports. The new asar is 5.1 MiB, contains no source maps or Codex vendor
files, and has no update-feed metadata when no feed is configured. The Codex
provider continues to use the separately installed `codex` executable.

## Before: 15 largest files

Paths are relative to `Juno.app`.

- 235.22 MiB — `Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`
- 193.29 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`
- 138.86 MiB — `Contents/Resources/app.asar`
- 62.35 MiB — `Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex-code-mode-host`
- 15.84 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib`
- 11.82 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/resources.pak`
- 10.37 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat`
- 9.53 MiB — `Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-resources/voice/bin/codex-voice-host`
- 3.84 MiB — `Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-path/rg`
- 2.21 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`
- 1.78 MiB — `Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-resources/voice/lib/libgio-2.0.0.dylib`
- 1.68 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/ml.lproj/locale.pak`
- 1.67 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/ta.lproj/locale.pak`
- 1.63 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/kn.lproj/locale.pak`
- 1.55 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/te.lproj/locale.pak`

## After: 15 largest files

Paths are relative to `Juno.app`.

- 192.19 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`
- 15.84 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib`
- 11.82 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/resources.pak`
- 10.37 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat`
- 5.08 MiB — `Contents/Resources/app.asar`
- 2.21 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`
- 1.68 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/ml.lproj/locale.pak`
- 1.67 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/ta.lproj/locale.pak`
- 1.63 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/kn.lproj/locale.pak`
- 1.55 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/te.lproj/locale.pak`
- 1.50 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/hi.lproj/locale.pak`
- 1.44 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/bn.lproj/locale.pak`
- 1.42 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/gu.lproj/locale.pak`
- 1.39 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/mr.lproj/locale.pak`
- 1.30 MiB — `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/th.lproj/locale.pak`

## Verification

`origin/main` at `8e17a092` was already an ancestor; merging it reported
already up to date. The earlier gallery failure was
`apps/gallery/shift.spec.ts:200`, **Message thumbnail › arriving late does not
move anything**. It passed 20 repeated runs on a detached checkout of that
revision and passed in the branch's full 92-test gallery run. The earlier
failure has not been reproduced; it is not classified as unrelated.

The packaged smoke applies a credential-free ad-hoc signature when no Developer
ID signature is present, verifies it strictly, checks all six fuses, signs in
to fake Slack, reaches sidebar rows, and starts both utility processes. No Apple
account credentials or notarization were used.

`pnpm affected` passed after retrying two Namespace provisioning timeouts.
The full gallery passed 92 tests; desktop e2e passed 142. The retry reused those
unchanged successful inputs and passed typecheck, lint, unit tests, protocol
checks and pool tests. `pnpm package` produced the DMG and ZIP, each about
122.5 MiB. A build without a feed removes stale `latest-mac.yml` metadata.

On the final artifact, five cached-account launches took 585.7, 454.9, 454.3,
622.1 and 555.4 ms from process spawn to the first sidebar-row paint marker:
**555.4 ms median, 454.3–622.1 ms range**. The machine was an Apple M2 with 8 GiB
RAM running macOS 26.6.2. The smoke held the exclusive heavy-test lock, used
fake Slack's default seed and attached renderer CDP. The initial sign-in run
was excluded; filesystem caches were warm. An earlier run on the same trimmed
app measured 702.2 ms median (695.9–1139.3 ms), showing the shared host's
variability. This is not the large-workspace performance scenario or a p95
estimate, and does not certify the 500 ms warm-start budget.

The smoke verified RunAsNode, NODE_OPTIONS and Node CLI inspection **off**;
cookie encryption, embedded asar integrity validation and asar-only loading
**on**. Renderer CDP lets the smoke run without relaxing these fuses.

The owner still needs a Developer ID Application certificate and private key
(`.p12` plus export password), Apple Team ID, either Apple ID plus app-specific
password or an App Store Connect API key with its key ID and issuer, a public
feed URL, a release repository, and a GitHub token with Contents: write for
uploads. The token stays in the release environment. (10-17: the public feed
was replaced by the private `triptu/juno-releases` repository and a shipped
read-only token, ADR 0016.) See
[Releasing](development.md#releasing) for the exact variables and steps.
