---
name: releasing
description: How to publish a Juno release to triptu/juno-releases so installs update. Use when Tushar asks for a release, an update, a new version or a DMG he can update to. Covers the full-run gate, the publish command, the update token, urgent releases and what may go in the releases repository. Detail is in docs/development.md, "Releasing" and "Full runs".
---

# Releasing Juno

When Tushar asks for a release, you do all of it: the full run, any fixes, the publish and the check afterwards. Do not hand a step back to him. Nothing runs releases on a schedule.

A release is a patch version published to the private repository `triptu/juno-releases`. Installed apps check that repository and offer the update. A DMG built with `pnpm package` alone is not a release: installs never see it.

## Steps

Run these from a Juno checkout with dependencies installed (not the main checkout). Only one release runs at a time; `release:scheduled` holds a lock in the shared `.juno-status`.

1. **Look first.** `git fetch origin main`, then `pnpm release:scheduled --dry-run`. It prints the newest `origin/main` commit with a green full-run record, the gate result, the next version and the release notes. It changes nothing.
2. **Get a green full run if needed.** If the dry run says no eligible full run covers the changes you need, run `pnpm verify:main --ref origin/main` once (about 25 minutes, one remote plan on the laptop). Results land in the main checkout's `.juno-status/verify-main/`.
   - If it fails, find the cause. Fix failures in code (or start a fixer agent per failure) and merge the fixes, then run it once more. Never rerun in a loop hoping for green, and never weaken an assertion.
   - A test that fails only sometimes on main may be tagged `@flaky` and added to `.juno-status/release-waivers.json` with its reporter ID, reason and date ("Flakes" in `docs/development.md`). Waivers cover named test failures only, never a crash, timeout or missing report.
3. **Publish.** Read the updater token from the keychain straight into the command:

   ```sh
   JUNO_UPDATE_TOKEN="$(security find-generic-password -w -s juno-update-token -a juno)" pnpm release:scheduled
   ```

   It picks the commit, bumps the patch version in a scratch worktree, packages through the heavy lock, runs the packaged smoke (`test:package`), uploads, writes `CHANGELOG.md` in the releases repository and pushes a `Set version to x.y.z after release` commit to main. It refuses if the last release is under six hours old or nothing user-facing changed; tell Tushar that rather than working around it.
4. **Check.** `gh release view v<version> --repo triptu/juno-releases` shows the DMG, its block map and `latest-mac.yml`, marked latest. `git log origin/main -1` shows the version commit.
5. **Report** the version, the source commit, the changelog lines and whether it was urgent.

If a step fails after the upload, rerun the same command: it finishes only the main update and never uploads a published version again. A failed release leaves its worktree (`scheduled-release-<version>`) for inspection; remove it with `node scripts/worktree.mjs remove <name>` once done.

## Urgent releases

`--urgent` skips the full-run gate and the six-hour limit. Use it only for a fix to a problem hurting Tushar now: a CPU spin, data loss, a crash on launch. A new feature he wants to try is not urgent. The manual path is `pnpm release:version patch`, commit it, `JUNO_UPDATE_TOKEN=… pnpm package`, `pnpm test:package`, then `pnpm release:publish --urgent --notes <file>`. Run `pnpm verify:main --ref <commit>` for it afterwards; the command prints the commit.

## Rules

- **Never print the token.** Pass it only through the inline `$(security …)` above. Never echo it, write it to a file, or put it in a log, commit or prompt.
- **Releases are unsigned.** This Mac has no Developer ID identity, so do not set `JUNO_RELEASE=1`. Installs update by downloading the DMG. Signing needs credentials only Tushar has ("What the owner provides").
- **The releases repository holds only releases and `CHANGELOG.md`.** Every install can read it with the shipped token (ADR 0016). Never push code, notes, logs or anything else there.
- **Changelog lines are for the person using Juno**: plain, short, SPEC section 17 style. `release:scheduled` writes them from commit subjects; with `release:publish --notes`, write them yourself.
- **Versions only go up.** Never delete or replace a published stable release. A `--prerelease` test upload may be deleted afterwards with `gh release delete v<version> --repo triptu/juno-releases --cleanup-tag --yes`.
- One remote run at a time, and stop only your own processes.
