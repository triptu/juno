---
name: do-release
description: How to publish a Juno release to triptu/juno-releases so installs update. Use when Tushar asks for a release, an update, a new version or a DMG he can update to. Covers the one release command, writing the highlights while it runs, failed full runs, the update token, urgent releases and what may go in the releases repository. Detail is in docs/development.md, "Releasing" and "Full runs".
---

# Releasing Juno

When Tushar asks for a release, you do all of it: any fixes, the highlights, the publish and the check. Do not hand a step back to him. Nothing runs releases on a schedule.

A release is a patch version published to the private repository `triptu/juno-releases`. Installed apps check that repository and offer the update. A DMG built with `bun run package` alone is not a release: installs never see it.

## The command

`bun run release` does the whole release. You step in only for judgement: the highlights, and fixes when the full run fails. Run it from a Juno checkout with dependencies installed (not the main checkout). Only one release runs at a time; it holds `.juno-status/release.lock` in the main checkout.

1. **Look first.** `bun run release --dry-run`. It changes nothing and does not fetch, so `git fetch origin main` first. It prints the tip of `origin/main`, the last release, the next version, the commits since the last release, and whether a green full run already covers the tip or which `verify:main` it would run. Also run `gh release list --repo triptu/juno-releases --limit 3`; another agent may have released while you worked.
2. **Start it in the background**, with the updater token read from the keychain straight into the command:

   ```sh
   JUNO_UPDATE_TOKEN="$(security find-generic-password -w -s juno-update-token -a juno)" bun run release
   ```

   It fetches main and takes its tip. It stops if the tip is already released, has nothing user-facing since the last release (tell Tushar that rather than working around it), or does not descend from the last release. Then it prints the commits since the last release and the path of the highlights file (`.juno-status/release-<version>-notes.md` in the main checkout; `--notes <file>` names another). It first commits the version bump in its release worktree. If no green full run covers that build, it runs `bun run verify:main --ref <build>` on the laptop, about two minutes once it has cores. It asks for them at high priority, so it starts before any waiting agent job but still waits for running jobs to finish (up to an hour). It never runs the full run on this Mac; an unreachable laptop fails it.

   While that runs, it packages and smoke-tests the same build on the Mac through the exclusive heavy lock, then uploads a draft. Installs read `/releases/latest`, so the draft cannot be offered as an update and is never marked latest. The gate is one green full run covering the build. A full run runs every test (the `@heavy` crash and restore journeys, huddles, extra sync and shift variants and the six feel scenarios included), so nothing else is needed. The gallery reuses the walk records of unchanged states and checks a fresh 5% sample of them again (every state once a week); the record lists what it walked, reused and sampled. A record whose suites skipped tests (a normal full run before 10-26) does not count. Detail is in docs/development.md, "The release command".
3. **Write the highlights while it runs** (below), to the path it printed. The command waits for that file after the full run, reads it once it has not changed for a second, and says what is wrong if it is not valid, then waits for a corrected file.
4. **When it finishes**, it has packaged, run the packaged smoke, uploaded a draft, checked the gate again, written your highlights as the version's section of `CHANGELOG.md` in the releases repository, checked the GitHub release (DMG, block map, `latest-mac.yml`, marked latest), pushed `Set version to x.y.z after release` to main, and removed its release worktree. Report the version, the source commit, the highlights and whether it was urgent.

## Write the highlights

The command lists the commits since the last release. They are input, not the changelog. Write a file of 3 to 8 lines, one `- ` line each, that a person using Juno would care about: what they see or can do now. Read the commits, and the diff where a subject is unclear, and keep only what a user would notice. Leave out packages, tests, specs, refactors, budgets, CI, internal names and commit hashes. Join small related commits into one line ("Right-click an image to open, copy or download it"). Each line is one plain sentence in SPEC section 17 style: sentence case, no hype, no emoji. No group headings: the app shows every line as one bullet. The command refuses more than ten lines or a commit hash. `bun run release --dry-run` shows the lines as they will be published.

## When the full run fails

The command waits for its package and upload job to stop, deletes its draft and discards the package. Nothing is published. It prints the record, each failed suite with its failures, recorded cause and log, and the repair command.

- Find the cause from the logs. Fix failures in code (or start a fixer agent per failure) and merge the fixes to main. Confirm each failure's cause (`product`, `test`, `infrastructure` or `cancellation`) with `bun scripts/verify-records.mjs <record.json> <suite> <category> "evidence"`. Never weaken an assertion.
- Then rerun the same `bun run release` command. It repairs an eligible failed ancestor with `verify:main --ref <build> --repair <record>`: failed and unfinished files plus everything the fix reaches, with no count or time cap. If the failed version commit is on another branch, it starts a fresh full run on the new version commit. A repair by hand must target a fixed descendant of the failed commit. A repair needs the same runtime and platform as the failed run; otherwise `verify:main` refuses and you run a fresh full run with `bun run verify:main --ref origin/main`.
- If main has not changed since the failed run, the command refuses to run anything: a rerun without a fix only hopes for green. If the failure was the laptop itself (a lost connection, `infrastructure`), run the printed repair by hand once, then rerun the release.
- A fix that changes how the app behaves (not only a test or the harness) gets one review from the other model family before you publish, and the report lists it. Release-time fixes land in the area that changed most that day, with the least review.

## Reruns

Rerun the same command after any failure. A green record that covers the tip is reused, and highlights already written are read again. If the upload happened but the main version update failed, a rerun checks the assets and latest mark, then finishes only that update and never uploads a published version again. A failed release keeps its clean version worktree (`release-<version>`) for inspection. A rerun reuses it for the same source or replaces it after main changes; dirty or unrelated worktrees are refused. An interrupted upload can leave a draft, which only the same build can resume or discard with `release:publish --discard-draft`. If the command waits too long for the highlights (60 minutes; `--notes-timeout <minutes>`), it stops; write them and rerun.

## Urgent releases

`release:publish --urgent` skips the full-run gate. Use it only for a fix to a problem hurting Tushar now: a CPU spin, data loss, a crash on launch. A new feature he wants to try is not urgent. The manual path is `bun run release:version patch`, commit it, `JUNO_UPDATE_TOKEN=… bun run package`, `bun run test:package`, then `bun run release:publish --urgent --notes <file>` with highlights written as above. Then merge that `Release x.y.z` commit into main: the release records it as its source, and the next `bun run release` refuses a tip that does not descend from it. Run `bun run verify:main --ref <commit>` for it afterwards; the command prints the commit.

## Rules

- **Never print the token.** Pass it only through the inline `$(security …)` above. Never echo it, write it to a file, or put it in a log, commit or prompt.
- **Releases are unsigned.** This Mac has no Developer ID identity, so do not set `JUNO_RELEASE=1`. Installs update by downloading the DMG. Signing needs credentials only Tushar has ("What the owner provides").
- **The releases repository holds only releases and `CHANGELOG.md`.** Every install can read it with the shipped token (ADR 0016). Never push code, notes, logs or anything else there.
- **The changelog is highlights, not a commit list.** You write each version's 3 to 8 lines for the person using Juno; `bun run release` and `release:publish` only publish what the highlights file holds. Never paste commit subjects in.
- **Versions only go up.** Never delete or replace a published stable release. A `--prerelease` test upload may be deleted afterwards with `gh release delete v<version> --repo triptu/juno-releases --cleanup-tag --yes`.
- One remote run at a time, and stop only your own processes.
