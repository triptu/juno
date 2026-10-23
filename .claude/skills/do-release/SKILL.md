---
name: do-release
description: How to publish a Juno release to triptu/juno-releases so installs update. Use when Tushar asks for a release, an update, a new version or a DMG he can update to. Covers the full-run gate, the publish command, the update token, urgent releases and what may go in the releases repository. Detail is in docs/development.md, "Releasing" and "Full runs".
---

# Releasing Juno

When Tushar asks for a release, you do all of it: the full run, any fixes, the publish and the check afterwards. Do not hand a step back to him. Nothing runs releases on a schedule.

A release is a patch version published to the private repository `triptu/juno-releases`. Installed apps check that repository and offer the update. A DMG built with `pnpm package` alone is not a release: installs never see it.

## Steps

Run these from a Juno checkout with dependencies installed (not the main checkout). Only one release runs at a time; `release:scheduled` holds a lock in the shared `.juno-status`.

1. **Look first.** `git fetch origin main`, then `pnpm release:scheduled --dry-run`. It prints the newest `origin/main` commit with a green full-run record, the gate result, the next version and the changes since the last release. It changes nothing. "Selected commit does not descend from the last released source; refusing a rollback" means no green full run covers anything newer than the last release: go to step 2. Also run `gh release list --repo triptu/juno-releases --limit 3`; another agent may have released while you worked.
2. **Get a green full run if needed.** If the dry run says no eligible full run covers the changes you need, run `pnpm verify:main --ref origin/main` once. It uses the laptop when reachable and falls back to this Mac if the host is unreachable. Use `--local` to select this Mac directly; the full plan runs sequentially through the exclusive heavy lock with bounded workers. Use `--local --dry-run` to inspect the plan first. Local and remote green records qualify for the same release gate and both refresh coverage. Results land in the main checkout's `.juno-status/verify-main/`.
   - Commit the refreshed `apps/desktop/e2e/coverage-map.json` the run leaves in your checkout, as "Refresh the e2e coverage map", and merge it with your fixes.
   - If it fails, find the cause. Fix failures in code (or start a fixer agent per failure) and merge the fixes, then run it once more. Never rerun in a loop hoping for green, and never weaken an assertion.
   - A fix that changes how the app behaves (not only a test or the harness) gets one review from the other model family before you publish, and the report lists it. Release-time fixes land in the area that changed most that day, with the least review.
3. **Write the highlights.** The dry run lists the commits since the last release. They are input, not the changelog. Write a file of 3 to 8 lines, one `- ` line each, that a person using Juno would care about: what they see or can do now. Read the commits, and the diff where a subject is unclear, and keep only what a user would notice. Leave out packages, tests, specs, refactors, budgets, CI, internal names and commit hashes. Join small related commits into one line ("Right-click an image to open, copy or download it"). Each line is one plain sentence in SPEC section 17 style: sentence case, no hype, no emoji. No group headings: the app shows every line as one bullet. Then `pnpm release:scheduled --dry-run --notes <file>` shows the lines as they will be published; the script refuses more than ten lines or a commit hash.
4. **Publish.** Read the updater token from the keychain straight into the command:

   ```sh
   JUNO_UPDATE_TOKEN="$(security find-generic-password -w -s juno-update-token -a juno)" pnpm release:scheduled --notes <file>
   ```

   It picks the commit, bumps the patch version in a scratch worktree, packages through the heavy lock, runs the packaged smoke (`test:package`), uploads, writes your highlights as the version's section of `CHANGELOG.md` in the releases repository and pushes a `Set version to x.y.z after release` commit to main. Without `--notes` it stops before building. There is no minimum gap between releases. It refuses if nothing user-facing changed; tell Tushar that rather than working around it.
5. **Check.** `gh release view v<version> --repo triptu/juno-releases` shows the DMG, its block map and `latest-mac.yml`, marked latest. `git log origin/main -1` shows the version commit.
6. **Report** the version, the source commit, the highlights and whether it was urgent.

If a step fails after the upload, rerun the same command: it finishes only the main update and never uploads a published version again. A failed release leaves its worktree (`scheduled-release-<version>`) for inspection; remove it with `node scripts/worktree.mjs remove <name>` once done.

## Urgent releases

`--urgent` skips the full-run gate. Use it only for a fix to a problem hurting Tushar now: a CPU spin, data loss, a crash on launch. A new feature he wants to try is not urgent. The manual path is `pnpm release:version patch`, commit it, `JUNO_UPDATE_TOKEN=… pnpm package`, `pnpm test:package`, then `pnpm release:publish --urgent --notes <file>` with highlights written as in step 3. Then merge that `Release x.y.z` commit into main: the release records it as its source, and the next `release:scheduled` refuses any commit that does not descend from it. Run `pnpm verify:main --ref <commit>` for it afterwards; the command prints the commit.

## Rules

- **Never print the token.** Pass it only through the inline `$(security …)` above. Never echo it, write it to a file, or put it in a log, commit or prompt.
- **Releases are unsigned.** This Mac has no Developer ID identity, so do not set `JUNO_RELEASE=1`. Installs update by downloading the DMG. Signing needs credentials only Tushar has ("What the owner provides").
- **The releases repository holds only releases and `CHANGELOG.md`.** Every install can read it with the shipped token (ADR 0016). Never push code, notes, logs or anything else there.
- **The changelog is highlights, not a commit list.** You write each version's 3 to 8 lines for the person using Juno (step 3); `release:scheduled` and `release:publish` only publish what `--notes <file>` holds. Never paste commit subjects in.
- **Versions only go up.** Never delete or replace a published stable release. A `--prerelease` test upload may be deleted afterwards with `gh release delete v<version> --repo triptu/juno-releases --cleanup-tag --yes`.
- One remote run at a time, and stop only your own processes.
