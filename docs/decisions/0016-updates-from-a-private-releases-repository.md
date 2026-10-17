# 0016. Updates from a private releases repository with a read-only token

Status: accepted, 2026-10-17. Built in `apps/desktop/src/main/updates.ts`, `releaseFeed.ts` and `scripts/release-publish.ts`.

## Context

Juno's source repository, `triptu/juno`, is private. electron-updater reads GitHub Releases, which for a private repository need a token on every request. The earlier plan was a public feed, which would publish every build. The owner decided: "a separate also private repo for it, and we'll ship a token scoped to that repo. changelog can also be maintained and fetched from that repo on demand." The build is also not yet Developer ID signed, and Squirrel.Mac, which electron-updater uses on macOS, will not install an update into an app without a stable signature.

## Decision

- Builds and the changelog live in the private repository `triptu/juno-releases`: one GitHub Release `v<version>` per version with the DMG, ZIP, block maps and `latest-mac.yml`, and one `CHANGELOG.md`, newest section first.
- The app ships a fine-grained personal access token with read-only access to that one repository (Contents: read, Metadata: read). `build/package.cjs` takes it from `JUNO_UPDATE_TOKEN` at package time, refuses anything that is not a fine-grained token, and writes it into the app's `update.json`, inside the asar. It is never committed, printed, logged or sent anywhere but the API's origin.
- Main reads releases itself (`/releases/latest`, which skips drafts and pre-releases) and fetches `CHANGELOG.md` only when "What's new" is asked for. A signed build then downloads and installs through electron-updater's private GitHub provider, wrapped in a custom provider so the shipped token is always the one used.
- An unsigned build, and a signed build whose in-place download fails, offers "Download the new version": main downloads the DMG with the token, saves it to Downloads and opens it.
- Publishing uses `gh` with the owner's own login (`pnpm release:publish`), never the shipped token. Versions are semver, set with `pnpm release:version`.

## Consequences

- Anyone with a copy of the app can extract the token and read the releases repository: its builds and changelog. That is the same as having the app, so the repository must hold nothing else. The token cannot write, and it can be revoked; a revoked or expired token stops updates for installs that carry it, so give it no expiry or a long one, and ship a new build well before it expires.
- Until the app is Developer ID signed and notarized, updating is a manual install from the DMG, and macOS asks once more for the "Juno Safe Storage" keychain item after each one.
- GitHub's API allows 5,000 requests an hour per token, shared by every install. One check per install every six hours is far below that for a small group.

## Alternatives

- **A public releases repository or feed.** No token in the app, but every build is public.
- **The generic provider against asset URLs.** It cannot resolve "latest" in a private repository without the API, and would still need the token in every request.
- **A proxy server holding the token.** Keeps the token out of the app, but adds a service to run and pay for.
