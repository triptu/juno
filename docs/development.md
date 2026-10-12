# Development

How to build and run Juno, and how the repo is put together.

## Prerequisites

- Node 24 or newer (Node 26 is what this was built with).
- pnpm 12. Node 25+ has no Corepack, so install it directly: `npm i -g pnpm@12`.
- macOS for the window chrome and e2e tests. Nothing else is platform-specific yet.

No Playwright browser download is needed. Electron is the browser.

## Commands

Run these from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs everything. Electron downloads its binary in a postinstall. |
| `pnpm dev` | Starts electron-vite with HMR for the renderer and reload for main and preload. |
| `pnpm build` | Builds main, preload and renderer into `apps/desktop/out/`. |
| `pnpm typecheck` | Runs `tsc` in every package. |
| `pnpm lint` | Runs oxlint, then a script that fails on any `cursor: pointer`. |
| `pnpm test` | Runs every package's vitest suite (`packages/*/test`). |
| `pnpm test:e2e` | Builds, then runs the Playwright tests against the built app. |
| `pnpm package` | Builds a DMG and zip with electron-builder into `apps/desktop/release/`. Not run in CI yet. |

Copy `.env.example` to `.env` for local secrets. `.env` is ignored by git.

## Layout

```
apps/desktop            The Electron app. Thin wiring only.
  src/main              Window factory, IPC handlers, app lifecycle.
  src/preload           contextBridge. Exposes window.juno and nothing else.
  src/renderer          React root, global.css, state atoms.
  e2e                   Playwright tests and the Electron launch fixture.
  electron.vite.config.ts
  electron-builder.yml
packages/tokens         @juno/tokens. The only place design values live.
packages/ui             @juno/ui. Presentational React components, StyleX only.
packages/contract       @juno/contract. IPC channel names and Effect Schemas.
packages/store          @juno/store. cache.db and user.db per workspace, migrations,
                        writer and reader clients, invalidation and live queries.
scripts                 Small repo scripts used by package.json.
docs                    Research, design handoff, this file.
```

Workspace packages ship TypeScript source. Their `exports` point at `src/*.ts` and
the app's Vite build compiles them. There is no per-package build step.

Each package has its own `tsconfig.json` that extends `tsconfig.base.json` (strict,
`moduleResolution: bundler`, `verbatimModuleSyntax`). The desktop app has three:
`tsconfig.node.json` for main and preload, `tsconfig.web.json` for the renderer and
`tsconfig.e2e.json` for tests, because they need different `lib` and `types`.

## How tokens flow into StyleX

1. `packages/tokens/src/tokens.stylex.ts` calls `stylex.defineVars` for colours,
   shadows, radii, spacing, fonts, type scale, motion and layout. Every key starts
   with `--`, so StyleX emits a CSS variable with that exact name, for example
   `--background` or `--foreground-default`. Values are the light theme from
   `docs/design/handoff/prototype/colors_and_type.css`.
2. `packages/tokens/src/themes.stylex.ts` calls `stylex.createTheme` with the dark
   values. `dark` is the pair of classes (colours and shadows) to apply.
3. Components import tokens through the subpath, never a barrel:
   `import { colors } from '@juno/tokens/tokens.stylex'`, then use
   `colors['--background']` inside `stylex.create`.
4. `@stylexjs/unplugin` in `electron.vite.config.ts` compiles every `stylex.create`
   and `defineVars` call into one CSS file during the renderer build. In dev it
   injects a virtual stylesheet into `index.html` itself.
5. Because the variable names are stable, plain CSS can use them too.
   `apps/desktop/src/renderer/global.css` sets the body font and background with
   `var(--font-sans)` and `var(--background)`, and the e2e test reads the same
   variables to check computed colours.
6. The theme is switched by `applyTheme()` in `src/renderer/state/theme.ts`, which
   puts the dark classes on `<html>` so portals attached to `<body>` are covered.

Rules that come from the design spec and are enforced in `@juno/ui`:

- Default arrow cursor, never `cursor: pointer`. `pnpm lint` fails on it.
- Buttons scale to 0.96 on press, never when disabled.
- Hover styles only inside `@media (hover: hover)`.
- 2px focus ring in `--selection-background` on `:focus-visible` only.
- Fonts are `@fontsource-variable/inter` and `@fontsource/instrument-serif`, bundled
  by Vite from `src/renderer/main.tsx`. Never load fonts from a URL. Instrument Serif
  has one weight (400).

## IPC

`packages/contract` defines a route per channel: a name, an input schema and an
output schema. Main registers handlers through `handle()` in `src/main/ipc.ts`,
which checks the sender is the main frame of one of our windows, decodes the input
and encodes the output. The preload turns each route into one function on
`window.juno`. The renderer decodes the answer again (see `state/appInfo.ts`) and
exposes it as an `@effect/atom-react` atom.

`packages/contract/src/channels.ts` has no runtime imports. The preload bundles only
that file so it stays a few hundred bytes. Schemas live in `index.ts`.

## Pitfalls met while setting this up

- **`ELECTRON_RUN_AS_NODE=1` in the shell.** Editors built on Electron export it to
  child shells. With it set, Electron starts as plain Node and never opens a window.
  `scripts/without-run-as-node.mjs` strips it for `dev`, `start` and `test:e2e`, and
  `playwright.config.ts` deletes it again.
- **pnpm 12 blocks install scripts.** `pnpm-workspace.yaml` must list `electron` and
  `esbuild` under `allowBuilds` (the old `onlyBuiltDependencies` key is ignored). If
  `apps/desktop/node_modules/electron/dist` is missing after install, run
  `node install.js` inside that directory once.
- **pnpm 12 minimum release age.** It refused `effect@4.0.3` as too new and wrote an
  exclusion into `pnpm-workspace.yaml`. Expect the same for other day-old releases
  (it did it again for `vitest@5.0.4`).
- **`node:sqlite` and Node versions.** Electron 44 runs Node 24.21; the system Node is
  26. `@effect/sql-sqlite-node` uses `isTransaction`, `columns()`, `setReturnArrays`
  and `backup`, and the store uses FTS5; all were checked in Electron's own Node. To
  run a package's tests under that Node:
  `ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/.pnpm/node_modules/vitest/vitest.mjs run`
  from the package directory. Node 24 prints an ExperimentalWarning for `node:sqlite`;
  it is harmless.
- **Store tests and the test clock.** `@effect/vitest`'s `it.effect` runs with a
  `TestClock`, so a live query's debounce window never ends on its own; tests call
  `TestClock.adjust(DEFAULT_LIVE_QUERY_DEBOUNCE)`. Use `it.live` for real time.
- **StyleX token imports.** Tokens must be imported through a subpath ending in
  `.stylex` (`@juno/tokens/tokens.stylex`). Re-exporting from an `index.ts` fails
  the build with "Could not resolve the path to the imported file".
- **Workspace packages in main and preload.** `externalizeDepsPlugin` externalises
  every dependency, including `@juno/contract`, which would then be `require`d as
  TypeScript at runtime. The config excludes it so it gets bundled.
- **`app.getVersion()` in tests.** Launching Electron with the script path makes it
  report Electron's own version. The fixture launches the package directory, like
  `electron .`, and `package.json` has `productName: "Juno"`.
- **`:disabled` before `:active`.** StyleX orders pseudo-classes so `:active` wins
  over `:disabled` at equal specificity. Disabled buttons set `pointer-events: none`,
  so `:active` can never match them.
- **No `getLastWebPreferences` in Electron 44.** The e2e test checks isolation from
  the page side (`require` and `process` are undefined, only `window.juno` exists).
- **`.browserslistrc`** targets Chromium 152 so lightningcss does not rewrite
  `light-dark()` into a no-op polyfill.
