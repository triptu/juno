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
| `pnpm test:e2e` | Builds, then runs the Playwright tests against the built app. |
| `pnpm --filter @juno/engine test` | Runs the engine's vitest suite (the port protocol over an in-memory MessageChannel, delta diffing). |
| `pnpm package` | Builds a DMG and zip with electron-builder into `apps/desktop/release/`. Not run in CI yet. |

Copy `.env.example` to `.env` for local secrets. `.env` is ignored by git.

## Layout

```
apps/desktop            The Electron app. Thin wiring only.
  src/main              Window factory, IPC handlers, engine supervisor, juno:// scheme, launch.json.
  src/engine            Entry of the engine utility process: parentPort in, startEngine().
  src/preload           contextBridge. Exposes window.juno and forwards the engine port.
  src/renderer          React root, global.css, containers (wire atoms to views), views.
  e2e                   Playwright tests and the Electron launch fixture.
  electron.vite.config.ts
  electron-builder.yml
packages/tokens         @juno/tokens. The only place design values live.
packages/ui             @juno/ui. Presentational React components, StyleX only.
packages/contract       @juno/contract. Routes (effect/rpc groups), live-query schemas, errors,
                        parentPort and port-handoff messages, main IPC channels.
packages/engine         @juno/engine. The engine: protocol server, feature handlers, startEngine().
packages/state          @juno/state. The renderer's engine client and every atom.
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

## Processes

Three processes talk to each other (`docs/architecture.md` section 2):

- **main** forks the **engine** as an Electron utility process (`src/main/engine.ts`,
  built from `src/engine/index.ts` to `out/main/engine.js`) with the `persist:slack`
  partition and `serviceName: 'juno-engine'`, restarts it with backoff when it exits,
  and serves the renderer from `juno://app/` (`src/main/scheme.ts`).
- The **renderer** talks to the engine over one `MessagePort`. It asks main for a port
  (`window.juno.engine.requestPort()`), main creates a `MessageChannelMain`, posts one
  end to the engine and the other to the renderer, and the preload forwards it to the
  page with `window.postMessage`. When the engine dies the port fires `close`; the
  renderer asks for a new one and every live query re-subscribes.
- Everything on the port is `effect/rpc` (ADR 0009). Routes are declared once in
  `packages/contract/src/routes/<feature>.ts`, served by `packages/engine`, and
  called through `liveQuery(route)` and `command(route)` from `packages/state`.

`startEngine(transport, config)` in `@juno/engine` runs under plain Node too: the
vitest suite in `packages/engine/test` connects the real state client to it over a
`worker_threads` `MessageChannel`. Under `JUNO_E2E=1` main exposes
`globalThis.junoTest` (engine pid and supervisor state) for Playwright.

## IPC with main

`packages/contract` defines a route per channel: a name, an input schema and an
output schema. Main registers handlers through `handle()` in `src/main/ipc.ts`,
which checks the sender is the main frame of one of our windows showing
`juno://app/` (or the Vite dev URL), decodes the input and encodes the output. The
preload turns each route into one function on `window.juno`. The renderer decodes
the answer again (see `packages/state/src/shell.ts`) and exposes it as an atom.

`packages/contract/src/channels.ts` has no runtime imports. The preload bundles only
that file so it stays under a kilobyte. Schemas live in `index.ts`.

## Adding a route

1. `packages/contract/src/routes/<feature>.ts`: export each route and the group.
   `liveQuery('feature.thing', { value, payload? })` streams a single value;
   `liveList('feature.rows', { row, payload })` streams a windowed list as deltas
   (rows need `id` and `rev`, the payload needs `window`); `Rpc.make('feature.do',
   { payload, success, error })` is a command. Errors come from `errors.ts`.
2. `packages/engine/src/<feature>/handlers.ts`: `<Feature>Routes.toLayer(...)`. Build
   live queries with `liveValue` / `liveList` from `protocol/live.ts`; they stamp
   `meta` and diff rows by `rev`. `engine/src/status/` is the example.
3. `packages/state`: `liveQuery(route)(payload)` and `command(route)` give the atoms.
   Containers read them with `useAtomValue` / `useAtomSet`. Nothing outside
   `packages/state` imports `effect/reactivity/Atom`, `effect/rpc` or `effect/workers`.
4. The integration task adds the group to `routes/index.ts` and the handler layer to
   `engine/src/layer.ts`.

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
  exclusion into `pnpm-workspace.yaml`. Expect the same for other day-old releases.
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
- **One request per port.** `RpcClient.layerProtocolWorker` is a worker pool, and a
  pool item's default `concurrency` is 1, so the first live query blocked every
  later command. `packages/state/src/transport.ts` sets it to a large number: one
  port carries everything.
- **Clients die with `Effect.provide`.** An `RpcClient` made inside
  `Effect.provide(protocolLayer)` is interrupted when that call returns. The client
  lives in `AtomRpc.Service` / `Atom.runtime`, whose scope outlives any atom.
- **Defects are fatal by default.** `RpcServer.layer` without `disableFatalDefects: true`
  ends the whole client when one handler dies. The engine sets it, so a defect is
  the `Exit` of that one request.
- **Result atoms need a mount.** Writing to a `command(route)` atom that nothing has
  mounted does nothing visible; `useAtomSet` mounts it in React, and tests call
  `registry.mount(atom)` first.
- **The preload has no `window` type.** `tsconfig.node.json` has no DOM lib, so
  `src/preload/index.ts` starts with `/// <reference lib="dom" />`.
- **`@juno/state` must typecheck without the DOM lib** because the engine's tests
  import it. Browser globals are reached through `globalThis` with local types
  (`perf.ts`, `port.ts`), never through the DOM lib's names.
- **Node and DOM `MessagePort`s** have the same `addEventListener` surface at runtime
  but different typings; tests cast Node ports to `PortLike` / `MessagePortLike`.
- **Renderer bundle size.** Adding `effect/rpc`, `effect/workers` and the JSON codecs
  took the initial JS from 856 KB to 1,086 KB, above the 1.0 MB budget in
  `docs/performance.md` before any feature code. The bundle check still needs to be
  written; the budget or the lazy-chunk plan has to absorb this.
