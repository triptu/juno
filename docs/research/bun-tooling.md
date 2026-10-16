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
