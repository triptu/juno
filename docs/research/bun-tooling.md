# Bun tooling comparison

Measured on macOS in the `bun-spike` worktree with Bun 1.4.3, TypeScript 7.0.2, pnpm 12.11.2 and oxlint 1.87.0. Each timed command ran under `scripts/heavy.mjs --exclusive`; tools were run in alternating order. The reported values are wall-clock medians of three runs. Cold install runs started with an empty `node_modules`; each warm run repeated the same installer with that tool's installed `node_modules` retained. Package caches were local. Bun's first cold install took 16.7 s while it migrated the workspace and populated its cache; the next two cold runs took about 2 s.

| Comparison | Current tool cold | Bun cold | Current tool warm | Bun warm |
| --- | ---: | ---: | ---: | ---: |
| Typecheck, full reference build | `tsc -b --force` 64.0 s | `bun check -b` 6.1 s | `tsc -b` 46.5 s | `bun check -b` 4.7 s |
| Lint (`oxlint .`) | 0.162 s | Not available | 0.161 s | Not available |
| Install | `pnpm install --frozen-lockfile` 2.77 s | `bun install` 2.20 s | 0.38 s | 0.22 s |
| `@juno/domain` unit tests (256 tests) | Vitest 2.27 s | `bun test` 0.196 s | Vitest 2.33 s | `bun test` 0.091 s |

Cold and warm typecheck runs used the same solution config: a temporary root config referencing the repository's 29 project configs plus the desktop, gallery and scripts configs (30 references total). Cold TypeScript runs used `--force`; warm runs used its generated build info. Bun has no build cache, so its warm measurement is a repeat check. The repository has no `composite` compiler option. Bun followed the references and reported no errors across the same 4,496 files in 29 projects.

## Correctness and behavior

- **Typecheck:** Added one deliberate `string` to `number` error in each of `@juno/domain` and `@juno/richtext`, then reverted both files. Both tools failed with TS2322 at the same two locations and reported the same type mismatch. Bun `check -b` followed the temporary solution config's project references and respected each project's options. It does not write `.tsbuildinfo`; `tsc -b` does, which enables the measured incremental run. The repository does not set `composite`, so composite-specific behavior was not exercised.
- **Lint:** Bun 1.4.3 has no standalone linter command. From the repo, `bun lint` resolves Juno's `lint` package script and runs oxlint plus the other project checks; from outside the repo it reports `Script not found "lint"`. It is not a Bun linter comparison, and oxlint rules cannot be evaluated against a Bun linter here. `oxlint .` passed all six timed runs.
- **Install:** `bun install` accepted the pnpm workspace, installed 530 packages, and wrote `bun.lock`. It migrated `pnpm-workspace.yaml` into a `workspaces` field in `package.json`, so the manifest had to be restored after each run. On a clean Bun install the Electron package was present in Bun's package store, but `electron/dist/Electron.app/Contents/MacOS/Electron` was absent; the native Electron postinstall did not complete. Bun reported success, but this install cannot run Juno's Electron app as-is. `bun.lock` was removed after each run.
- **Unit tests:** The unchanged `packages/domain/test` suite passed under both runners: 16 files and 256 tests. Bun's output reported 256 passes, zero failures and 517 expectations. No test files were changed.

## Recommendation

Use Bun's test runner for the pure `@juno/domain` suite: it ran the existing tests unchanged and was more than 11× faster on cold runs and about 25× faster on warm runs. Keep pnpm for installation because the Electron native binary was missing. Keep oxlint because Bun has no comparable standalone linter. Bun check is about 10× faster in this full-build measurement and matched the injected errors, but it has no build cache and the error probe is not proof of complete checker parity; keep the existing project-cached typecheck path for now.

These are local tool timings, not app performance measurements. Typecheck timings varied substantially between runs, and install timings include local package-cache effects.

## Adopted for local feedback

On 2026-10-16, routine checks switched to pinned Bun: `pnpm typecheck` checks every supported project locally, and `pnpm affected` uses the same check before remote suites. Unsupported projects are warned about and skipped; there is no TypeScript fallback. The manual TypeScript path is `pnpm typecheck:tsc`, and `pnpm typecheck:parity` remains a manual comparison. See [Typecheck](../development.md#typecheck) for the current commands.

Verification on the shared Mac used one comment-only change to `scripts/probe-integrations.ts`, which invalidated the scripts project. Both affected runs checked that project and ran lint. Wall time was 72.22 s before and 6.53 s after, one run each. The baseline remote image was ready after 56.0 s and TypeScript took 2.9 s; local Bun took 0.9 s. Mac load averages were about 5 to 7 on eight cores. This measures the developer loop, including remote startup, rather than a repeatable compiler speedup.

A deliberate `string` to `number` error in the desktop renderer failed locally in 2.27 s, before remote suites started. The probe was removed. `pnpm typecheck:parity` matched the same one diagnostic across all 29 projects in 179.4 s. Plugin, declaration and emit option probes selected TypeScript fallback; a selected desktop web check passed through `tsc -b` in 4.4 s. The Linux x64 image build passed its pinned Bun version assertion, and the installed Mac executable was confirmed as ARM64.

The final `pnpm affected --base origin/main` attempt passed local Bun checking and lint, but its remote suites never started after more than eight minutes waiting for Namespace capacity. Those queued jobs were cancelled. Health tests and remote-pool tests passed during verification. Full remote-suite verification remains incomplete. After excluding build-info files from input hashes, `pnpm affected --base HEAD` passed all 29 projects locally and lint.

## Bun 1.4.4

On 2026-10-24, Bun 1.4.3 and 1.4.4 ran `bun check -b --all` five times each, in alternating order, over the same solution config of 35 projects, under `scripts/heavy.mjs --exclusive`. Load averages rose from 3.3 to 7.8 during the runs because other agents shared the Mac. Every run passed. Median wall time was 4.83 s for 1.4.3 (range 4.42–6.49 s) and 2.90 s for 1.4.4 (range 2.54–3.13 s). A deliberate `string` to `number` error in `@juno/domain` failed under 1.4.4 in 2.9 s, and `pnpm typecheck:parity` matched TypeScript across all 35 projects in 145.8 s.
