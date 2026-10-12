# Juno tech stack research

Date: 2026-10-12. Versions come from `npm view` on this date. Items marked "(tested)" were run on this machine (macOS, Node 26.11.1, bun 1.3.10) in throwaway folders under `/tmp`. Everything else comes from the linked docs or package contents.

## Short version

| Area | Pick |
| --- | --- |
| Electron | 44.7.0 now, move to 45 after its stable date (Oct 20, 2026) |
| Build | electron-vite (5.0.0 with Vite 7, or 6.0.0-beta.x for Vite 8) |
| Packaging | electron-builder 26.15.3 |
| Styling | StyleX 0.19.1 with `@stylexjs/unplugin` |
| Business logic | Effect 4.0.3 (v4 is now stable and is the npm `latest`) |
| State | `@effect/atom-react` 4.0.3 (the v4 home of effect-atom), not `@effect-atom/*` |
| AI | `@earendil-works/pi-ai` 1.1.0 (the old `@mariozechner/pi-ai` is deprecated) |
| Local DB | `@effect/sql-sqlite-node` 4.0.3, which uses `node:sqlite` (no native module) |
| E2E | Playwright 1.64.0 with `_electron.launch` |
| Package manager | pnpm 12 (bun is a workable fallback) |
| Fonts | `@fontsource-variable/inter` and `@fontsource/instrument-serif` (both OFL-1.1) |
| Icons | `lucide-react` 1.55.0 |

Two things differ from what you may expect:

1. Effect 4 shipped stable on 2026-10-01. The `@effect-atom/*` packages still require Effect 3, so use the official `@effect/atom-react` instead.
2. `@mariozechner/pi-ai` is deprecated. Its npm page says "please use @earendil-works/pi-ai instead going forward".

---

## 1. Electron

**Versions** (releases.electronjs.org, npm):
- Latest stable: **44.7.0** (2026-10-07). Node 24.21.0, Chromium 152.
- Electron 45.0.0 is due **Oct 20, 2026** (Chromium 156, Node 24.21.0). `45.0.0-beta.1` is on npm today.
- Electron supports the latest three stable majors. 42 reaches end of life Oct 20, 2026. 43 ends Jan 5, 2027 and 44 ends Mar 2, 2027.

**Build tooling for a React + TS monorepo**
- **electron-vite** (`5.0.0`, Dec 2025). One config file for main, preload and renderer, with HMR for the renderer and hot reload for main and preload. Its peer range is Vite `^5 || ^6 || ^7` only. A `6.0.0-beta.8` (2026-10-10) adds Vite 8 and is actively released. Vite itself is at 8.3.4.
- **Electron Forge + Vite** (`@electron-forge/cli` 8.0.1, `plugin-vite` 8.0.1). Forge's docs still call the Vite plugin "experimental". It runs a separate Vite build per target and forces Vite `base: './'`. It is more config than electron-vite.
- **Plain Vite** for the renderer plus a small script for main and preload (tsdown or esbuild). Most control, most glue code. Not needed here.

**Packaging**
- **electron-builder** 26.15.3 (a 27 alpha is in progress). It does DMG, zip, notarization and auto-update through `electron-updater`. Its module collector has explicit pnpm and bun support (checked in `app-builder-lib` source).
- **Forge** also works, and the Electron docs list it as the official tool. Forge's update story is lighter (publishers plus `update-electron-app`), so check it against your update-hosting needs.

**Security defaults** (Electron security checklist):
- `contextIsolation` is on by default (since Electron 12). `sandbox` is on by default (since 20). `nodeIntegration` is off by default (since 5). Do not change these.
- Preload exposes a small API with `contextBridge.exposeInMainWorld`. Never expose `ipcRenderer` itself.
- Validate the sender of every IPC message (`event.senderFrame.url`).
- Set a Content Security Policy. Block navigation and `window.open`. Load the renderer from a custom protocol rather than `file://`.
- Sandboxed preloads cannot use ESM imports. Build the preload as a single bundled CommonJS file (electron-vite does this by default).
- Flip fuses with `@electron/fuses` for the shipped app: disable `RunAsNode` and `EnableNodeCliInspectArguments`. Playwright needs `EnableNodeCliInspectArguments` on, so run e2e against the unpackaged or a test-fused build.
- Keep API tokens in the main process and encrypt them with `safeStorage`.

**macOS window chrome** (Electron "Custom Title Bar" docs):

```ts
new BrowserWindow({
  titleBarStyle: 'hiddenInset',          // traffic lights inset by a fixed amount
  // or exact placement:
  // titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 14 },
  webPreferences: { preload, sandbox: true, contextIsolation: true },
})
```
- Make the top strip draggable with `-webkit-app-region: drag`, and set `no-drag` on buttons and inputs inside it. StyleX accepts both `WebkitAppRegion` and `appRegion` (tested).
- `titleBarOverlay` is for Windows and Linux window buttons. On macOS the native traffic lights are used.

**Native context menus** (`Menu.popup`, "Context Menu" tutorial): the menu is built in main. The renderer only asks for it.

```ts
// preload: expose one function
showContextMenu: (items) => ipcRenderer.invoke('menu:popup', items)

// main
ipcMain.handle('menu:popup', (event, items: { id: string; label: string }[]) =>
  new Promise<string | null>((resolve) => {
    const menu = Menu.buildFromTemplate(
      items.map((i) => ({ label: i.label, click: () => resolve(i.id) })),
    )
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender)!,
      callback: () => resolve(null),   // closed with no choice
    })
  }))
```
`popup` options: `window`, `x`+`y` (set both or neither; default is the cursor), `callback` (fires on close). In the renderer, call `event.preventDefault()` in the `contextmenu` handler.

**Recommendation:** Electron 44.7.0 today, upgrade to 45 once it is stable. Use electron-vite with Vite 7 for now (or the 6 beta if you want Vite 8), and package with electron-builder. Keep the three security defaults, expose a narrow `contextBridge` API, and build menus in main with `Menu.popup`.

Sources:
- https://releases.electronjs.org/schedule
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
- https://www.electronjs.org/docs/latest/tutorial/context-menu
- https://www.electronjs.org/docs/latest/api/menu
- https://www.electronjs.org/docs/latest/tutorial/esm
- https://electron-vite.org/guide/
- https://www.electronforge.io/config/plugins/vite
- https://www.electron.build/

---

## 2. StyleX

**Version:** `@stylexjs/stylex` and all `@stylexjs/*` packages are **0.19.1** (2026-09-15). It is still 0.x, so expect small breaking changes. License MIT.

**Vite integration:** use **`@stylexjs/unplugin`** 0.19.1. It is the official, current plugin and has Vite, Rollup, webpack, Rspack, esbuild and Bun entry points. The older `@stylexjs/webpack-plugin` and `@stylexjs/nextjs-plugin` are deprecated, and `vite-plugin-stylex` was last updated in 2024. Put the plugin before the React plugin:

```ts
import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
export default { plugins: [stylex.vite({ useCSSLayers: true }), react()] }
```
You need a CSS entry file imported by the app so the plugin has an asset to append to. In dev, the README says to add `/virtual:stylex.css` and `virtual:stylex:runtime` to the HTML shell.

**Tokens with `defineVars`** (docs, plus a build I ran):
- Variables must be named exports of a file ending in `.stylex.ts` (or `.stylex.js`).
- A key that starts with `--` produces a CSS variable with that exact name. Any other key gets a hashed name (`--x1hthk5i`).
- Values can hold `@media` conditions. Function values that read other keys are supported.

```ts
// packages/tokens/src/tokens.stylex.ts
import * as stylex from '@stylexjs/stylex'
export const color = stylex.defineVars({
  '--bg': { default: '#fff', '@media (prefers-color-scheme: dark)': '#111' },
  '--fg': 'light-dark(#111, #eee)',
  accent: '#3b82f6',
})
```
Built output (tested): `:root { --bg: #fff; --fg: light-dark(...); --x1hthk5i: #3b82f6 }` inside `@layer priority1`, plus a `@media (prefers-color-scheme: dark)` override for `--bg`.

**Central tokens file and raw CSS variables**
- Yes. Use `--`-prefixed keys for everything you also want outside StyleX (a canvas, inline styles, a global CSS reset, Playwright assertions). Then `var(--fg)` written by hand works, and `color['--bg']` works in `stylex.create` (both tested).
- Use unprefixed keys when you only want to read them through StyleX and keep names collision-free.

**Theming (`createTheme`):**
- `stylex.createTheme(color, { '--bg': '#111', accent: '#8b5cf6' })` returns a class. Apply it with `<html {...stylex.props(dark)}>` or on any subtree.
- The theme class beats the `:root` default (tested; the output uses a doubled class selector). So a user-chosen theme overrides the OS media query, and "System" means applying no theme class.
- Accent variants are a `createTheme` over just the accent key.
- `light-dark()` is a good fit since Electron 44 is Chromium 152, but see the pitfall below.

**Pitfalls (tested in a bun workspace with an app, a `ui` package and a `tokens` package):**
1. **Token files in a workspace package must be imported through a subpath that ends in `.stylex`.** With `exports: { ".": "./src/tokens.stylex.ts" }` and `import { color } from '@m/tokens'`, the build failed: "Could not resolve the path to the imported file. Please ensure that the theme file has a .stylex.js or .stylex.ts extension". It worked with `exports: { "./tokens.stylex": "./src/tokens.stylex.ts" }` and `import ... from '@m/tokens/tokens.stylex'`. Re-exporting tokens from an `index.ts` barrel will not work.
2. **Ship workspace packages as TypeScript source, not prebuilt JS.** A package that exports `src/*.tsx` was compiled correctly by the app's Vite build (tested). The plugin also auto-detects installed packages that depend on `@stylexjs/stylex` and keeps them out of Vite's dependency pre-bundling. Use `externalPackages: ['name']` to force that for others.
3. **Run Vite from the app package.** The plugin's `unstable_moduleResolution` defaults to `{ type: 'commonJS', rootDir: process.cwd() }`. If you run the build from the repo root, set `rootDir` explicitly. The Babel docs call this option unstable and "required if you use the theming APIs".
4. **`light-dark()` can break silently.** With no browserslist, lightningcss rewrote `--fg` into `var(--lightningcss-light, #111) var(--lightningcss-dark, #eee)`, which does nothing without `color-scheme` in the same file. Adding a `.browserslistrc` with `last 2 Chrome versions` fixed it (tested). Or pass `lightningcssOptions: { exclude: Features.LightDark }`. The unplugin README documents this.
5. **Every `defineVars` file must be in the import graph.** `treeshakeCompensation` is on by default for Vite and covers this.
6. **Declare `@stylexjs/stylex` as a dependency in every package that uses it**, so the single pnpm or bun layout resolves one copy.

**Media queries:** `(hover: hover)` works as a nested condition (tested):

```ts
backgroundColor: { default: color['--bg'], ':hover': { default: null, '@media (hover: hover)': color.accent } }
// -> @media (hover: hover) { .x:hover { background-color: var(--...) } }
```

**Recommendation:** Use `@stylexjs/unplugin` with `useCSSLayers: true`. Create one `tokens` package whose exports are `*.stylex.ts` subpaths, using `--`-prefixed keys. Add a `.browserslistrc` for Chromium. Do dark mode with `light-dark()` or a media-query default, and let `createTheme` classes force dark mode and accent variants. Keep UI packages as TypeScript source.

Sources:
- https://stylexjs.com/docs/api/javascript/defineVars/
- https://stylexjs.com/docs/api/javascript/createTheme/
- https://stylexjs.com/docs/api/configuration/unplugin/
- https://stylexjs.com/docs/api/configuration/babel-plugin/
- https://www.npmjs.com/package/@stylexjs/unplugin (README covers the lightningcss `light-dark()` note)

---

## 3. Effect

**Status:** **Effect 4 is stable.** `effect@latest` is **4.0.3** (2026-10-11). `4.0.0` shipped 2026-10-01, followed by 4.0.1, 4.0.2 and 4.0.3 within 11 days, so patches are frequent. Dist-tags: `latest` 4.0.3, `rc` 4.0.0-rc.118, `beta` 4.0.0-beta.107. Effect 3 gets bug fixes only.
- All ecosystem packages share one version number. `@effect/platform-node`, `@effect/sql-sqlite-node`, `@effect/atom-react`, `@effect/vitest`, `@effect/ai-openrouter` are all 4.0.3 and need `effect ^4.0.3`.
- `@effect/platform` (0.97.2), `@effect/rpc` (0.76.2) and `@effect/schema` (0.75.5) are the Effect 3 line. In v4 their code lives in `effect` itself (`effect/rpc`, `effect/sql`, `effect/http`, `effect/reactivity`, `Schema` in core). Platform-specific packages (`@effect/platform-node`, `platform-browser`) stay separate.
- Stability labels in the 4.0.3 source: `Effect`, `Layer`, `Stream`, `Context`, `ManagedRuntime`, `Queue`, `Ref` are `@stability stable`. `Schema` is mostly stable with some unstable parts. Everything under `rpc`, `sql`, `reactivity` and `http` is tagged `@stability unstable`, so minor releases may break those APIs.
- Many blog posts and AI-generated snippets show beta-era names (`ServiceMap.Service`). The stable name is **`Context.Service`**.

**Services and layers** (pattern from the package's own `ai-docs`; I ran a version of it):

```ts
import { Context, Effect, Layer } from 'effect'

export class Slack extends Context.Service<Slack, {
  postMessage(channel: string, text: string): Effect.Effect<void, SlackError>
}>()('juno/Slack') {            // id = package + path
  static readonly layer = Layer.effect(Slack, Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const postMessage = Effect.fn('Slack.postMessage')(function* (channel: string, text: string) { /* ... */ })
    return Slack.of({ postMessage })
  }))
}
```
- One service per small package, with a static `layer` that lists its own dependencies. Compose in a single app-layer file with `Layer.provide` and `Layer.provideMerge`.
- Use `Effect.fn('name')` for service methods (adds a span). Use `Schema.TaggedError` for typed errors.
- `ManagedRuntime.make(AppLayer)` is how non-Effect code (IPC handlers, React) runs effects.

**Schema:** `Schema.Struct`, `Schema.Class`, `Schema.decodeUnknownSync` and branded types work as in v3 (tested). Define API shapes (Slack payloads, IPC messages, DB rows) once in a shared package. `Schema.toJsonSchemaDocument` exists if you need JSON Schema output.

**Stream:** use it for Slack's real-time events, AI token streams and DB change feeds. `Stream.range(1,5).pipe(Stream.map(...), Stream.runCollect)` runs as expected (tested).

**Across main and renderer**
- The main process is the Effect runtime: Slack HTTP and websocket, SQLite, AI calls, secrets. Build it with `@effect/platform-node` (or `FetchHttpClient` from `effect/http`).
- The renderer is a thin Effect + atom layer talking to main. Use `@effect/platform-browser` only if you need browser services.
- **There is no official Electron transport for `effect/rpc`, and I found no maintained community one** (npm search for "effect electron" returned nothing relevant). The built-in protocols are HTTP, WebSocket, stdio and worker-runner. `RpcServer.Protocol.make` and `RpcClient.Protocol.make` let you write your own.
- Common pattern: define an `RpcGroup` in a shared package with Schema payloads and results. In main, create a `MessageChannelMain`, keep one port, and send the other to the renderer with `webContents.postMessage`. In the preload, forward the port to the page with `window.postMessage` (Electron's MessagePort tutorial pattern). Write about 100 lines of custom `Protocol` over that port (MessagePortMain uses `.on('message')` and `.postMessage`, not the web API, so an adapter is needed). This gives typed requests, streaming responses and cancellation. I have not built this adapter, so treat the effort as a rough estimate.
- Simpler fallback: a handful of `ipcRenderer.invoke` calls that decode with the shared Schemas on both sides, plus one `webContents.send` channel for pushed events. Start here and move to RPC when the API grows.

**SQL for local persistence:**
- **`@effect/sql-sqlite-node` 4.0.3 uses Node's built-in `node:sqlite` (`DatabaseSync`)**, not better-sqlite3. It has no native dependencies. I ran it inside Electron 44.7.0 (`ELECTRON_RUN_AS_NODE`) and it created a table and queried it (SQLite 3.53.4) (tested). So no `electron-rebuild` and no `asarUnpack` for the DB.
- It provides `SqlClient`, `SqliteMigrator`, `SqlSchema`/`SqlModel` for Schema-typed queries, and `Reactivity` for invalidating queries (which feeds atoms).
- better-sqlite3 13.0.3 is still maintained and faster for heavy sync work, but it needs rebuilding per Electron version. There is also `@effect/sql-sqlite-bun` if you ever run under bun.

**Recommendation:** Start on Effect 4.0.3 now. Pin an exact version, because rpc, sql and reactivity are marked unstable. Use `Context.Service` plus layers, one small package per service. Run all I/O in main behind a `ManagedRuntime`, and use `@effect/sql-sqlite-node` on `node:sqlite`. Begin with plain typed IPC and write a MessagePort `RpcServer`/`RpcClient` protocol when the API outgrows it.

Sources:
- https://www.npmjs.com/package/effect (dist-tags and release times via `npm view effect dist-tags time`)
- https://www.effect.website/blog/releases/effect/40-beta
- https://github.com/Effect-TS/effect-smol (migration guides, `MIGRATION.md`)
- Files inside the `effect@4.0.3` tarball: `ai-docs/src/01_effect/03_services/`, `src/rpc/RpcServer.ts`, `src/rpc/RpcClient.ts`, `src/sql/`
- https://www.electronjs.org/docs/latest/tutorial/message-ports

---

## 4. effect-atom

**Package names, which depend on your Effect version:**

| Effect | Packages | Latest | Notes |
| --- | --- | --- | --- |
| 3.x | `@effect-atom/atom`, `@effect-atom/atom-react` (Tim Smart's repo) | 0.7.1 / 0.7.0 | Peer `effect ^3.22.1`, `@effect/platform`, `@effect/rpc`, `@effect/experimental`. React `>=18 <20`. Last release 2026-09-26. |
| 4.x | **`@effect/atom-react`** (React), `@effect/atom-solid`, `@effect/atom-vue`. Core is `effect/reactivity/Atom` | 4.0.3 | Official, versioned with Effect. React `>=19 <20`. |

`@effect-atom/*` does not work with Effect 4 (its peer range is `effect ^3`). Since you are on Effect 4, use the official port. It is the same design moved into the Effect repo, but every module is tagged `@stability unstable`.

**Maturity:** The library was pre-1.0 (0.x) for its whole life, but it moved into the Effect monorepo for v4 and ships with the same version number. Fine for a new product if you accept API churn, pin versions, and wrap atoms behind your own small module so changes stay local. It is not a stable-semver API yet.

**API basics** (the core was run in Node, tested; React hooks read from the 4.0.3 source):

```ts
import { Effect } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { useAtomValue, useAtom, useAtomSet, RegistryProvider } from '@effect/atom-react'

const count = Atom.make(0)                                  // plain state
const runtime = Atom.runtime(AppLayer)                      // runtime atom from a Layer
const channels = runtime.atom(                              // effect-backed atom -> AsyncResult
  Effect.gen(function* () { return yield* (yield* Slack).listChannels })
)
const channel = Atom.family((id: string) => runtime.atom(/* effect using id */))  // stable atom per key
const send = runtime.fn<string>()(Effect.fnUntraced(function* (text) { /* mutation */ }))

function View() {
  const result = useAtomValue(channels)    // AsyncResult: Initial | Success | Failure, with a waiting flag
  const doSend = useAtomSet(send)
}
```
- Other pieces in `Atom`: `Atom.fn`, `Atom.pull` (streams), `Atom.keepAlive`, `Atom.map`, `Atom.kvs` (persisted), `Atom.searchParam`, `Atom.withReactivity`. Hooks: `useAtomValue`, `useAtom`, `useAtomSet`, `useAtomSuspense`, `useAtomMount`, `useAtomRefresh`, `RegistryProvider`.
- **Effect integration:** a runtime atom builds its Layer once, so services are available inside atom effects. `Reactivity` keys let a mutation invalidate queries, and `@effect/sql` can emit those keys. Atoms are cleaned up when unused unless `keepAlive`.
- In a verification run, a runtime atom backed by a `Context.Service` layer resolved to `Success 42` (tested).

**Alternatives if you want something steadier:**
- **Zustand** (plain external store) for UI state, with Effect running in main or in a runtime and pushing results into the store. Very stable, but you lose the Effect-native async handling.
- **TanStack Query** for server-ish state (Slack data), with Effect effects wrapped in `queryFn`.
- **Jotai** is closest in shape to atoms, with no Effect awareness.

**Recommendation:** Use `@effect/atom-react` 4.0.3 with `effect/reactivity/Atom`. Keep domain state, caching and data fetching in Effect services in main or a shared runtime, and use atoms only as the thin bridge to React. If atom API churn becomes a problem, swap the bridge layer for Zustand without touching the services.

Sources:
- https://github.com/tim-smart/effect-atom
- https://www.npmjs.com/package/@effect/atom-react
- Files in the `effect@4.0.3` and `@effect/atom-react@4.0.3` tarballs: `src/reactivity/Atom.ts`, `src/Hooks.ts`

---

## 5. pi-ai

**Package:** use **`@earendil-works/pi-ai` 1.1.0** (2026-10-07; repo github.com/earendil-works/pi; MIT; `engines.node >=22.19.0`). The old **`@mariozechner/pi-ai`** (last 0.73.1, May 2026) is marked deprecated on npm ("please use @earendil-works/pi-ai instead going forward"). The old repo path (badlogic/pi-mono) is the same project. A `legacy-node20` dist-tag (0.74.2) exists for old Node.

**API shape (1.x):** you create a `Models` collection, register providers, and call `models.stream` / `models.complete`. The old global `getModel`/`stream` still lives in `@earendil-works/pi-ai/compat` but is slated for removal. I confirmed that `openrouterProvider` loads, lists 401 chat models, and returns `anthropic/claude-sonnet-4.5` (tested).

**OpenRouter:**
- Env var: **`OPENROUTER_API_KEY`**. In browsers, pass `apiKey` per call. Stored credentials via a `CredentialStore` also work, and a stored credential wins over the env var.
- Model IDs are OpenRouter slugs, for example `anthropic/claude-sonnet-4.5` or `openrouter/auto`. The catalog only lists models that support tool calling.
- Import only the provider you need (`@earendil-works/pi-ai/providers/openrouter`), so bundlers do not pull in the other providers' SDKs. The default install is large (about 100 MB of `node_modules`, including AWS and Google SDKs), but only lazy chunks load per provider.

**Minimal sample** (from the README, trimmed to OpenRouter; `Type` is TypeBox, re-exported):

```ts
import { createModels, Type, validateToolCall, type Context, type Tool } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'

const models = createModels()
models.setProvider(openrouterProvider())                 // reads OPENROUTER_API_KEY
const model = models.getModel('openrouter', 'anthropic/claude-sonnet-4.5')!

const tools: Tool[] = [{
  name: 'get_time',
  description: 'Get the current time',
  parameters: Type.Object({ timezone: Type.Optional(Type.String()) }),
}]
const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'What time is it?', timestamp: Date.now() }],
  tools,
}

const s = models.stream(model, context)                  // or models.complete(...)
for await (const event of s) {
  if (event.type === 'text_delta') process.stdout.write(event.delta)
  if (event.type === 'toolcall_end') {
    const args = validateToolCall(tools, event.toolCall) // throws on bad args
    // run the tool, then push a { role: 'toolResult', toolCallId, toolName, content, isError, timestamp }
  }
}
context.messages.push(await s.result())
```
- Streaming events: `start`, `text_delta`, `thinking_delta`, `toolcall_start/delta/end`, `done`, `error`. Request failures after a stream starts do not throw; they arrive as an `error` event, and the final message has `stopReason: 'error'`.
- Aborts: pass a signal in the options. Context is plain JSON, so it can be saved and handed to another model mid-conversation.
- **Typed tools:** TypeBox schemas (`Type.Object(...)`), validated with `validateToolCall`. Strict JSON-schema constrained sampling exists for OpenAI, Anthropic, Mistral and Gemini 3, but the README says gateways like OpenRouter can mangle the strictest grammar tools, so rely on validation and retries.
- **Structured output:** there is no separate "response format" API. The pattern is to define a tool whose parameters are your output shape and force the model to call it, then validate. If you want Effect Schema as the source of truth, `Schema.toJsonSchemaDocument` can produce JSON Schema, but pi-ai expects TypeBox or plain JSON Schema, so I would not rely on that conversion without testing it.
- **Electron main:** yes. It targets Node >=22.19 and Electron 44 ships Node 24.21. It also runs in browsers, but then the key sits in the renderer, which the README warns against. Run it in main, keep the key in `safeStorage`, and stream tokens to the renderer over IPC or RPC.
- Wrap it as an Effect service: `Stream.fromAsyncIterable(s, (e) => new AiError({ cause: e }))` over the event stream, with `AbortSignal` tied to the fiber's scope.
- Alternative worth knowing: `@effect/ai-openrouter` 4.0.3 is an Effect-native OpenRouter client. You chose pi-ai, so I did not evaluate it.

**Recommendation:** Install `@earendil-works/pi-ai@1.1.0`, import only `providers/openrouter`, run it in main behind an `AiClient` Effect service, and use TypeBox tools with `validateToolCall`. Do not use the deprecated `@mariozechner/pi-ai`.

Sources:
- https://github.com/earendil-works/pi/tree/main/packages/ai (README)
- https://www.npmjs.com/package/@earendil-works/pi-ai
- https://www.npmjs.com/package/@mariozechner/pi-ai (deprecation notice)

---

## 6. Playwright for Electron e2e

**Version:** `@playwright/test` and `playwright` 1.64.0. Electron support is still labelled experimental in the API docs. It works for Electron v21+ and drives the app over Chrome DevTools Protocol. I found no Electron entries in the 1.55 to 1.64 release notes.

**Approach** (tested with Electron 44.7.0 and Playwright 1.64.0):

```ts
import { _electron as electron, test, expect } from '@playwright/test'

test('sends a message', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],                      // built main entry
    env: { ...process.env, JUNO_E2E: '1', JUNO_SLACK_API_URL: fake.url, JUNO_DB: tmpDb },
  })
  const win = await app.firstWindow()
  await win.getByRole('textbox', { name: 'Message' }).fill('hi')
  await win.keyboard.press('Enter')
  await expect(win.getByText('hi')).toBeVisible()
  await app.evaluate(({ app }) => app.isPackaged)     // runs in main
  await app.close()
})
```

**Gotchas and tips**
- **`ELECTRON_RUN_AS_NODE` must not be set.** In this environment it was set to `1`, and `electron.launch` failed with "Process failed to launch!" because Electron ran as plain Node. Run `delete process.env.ELECTRON_RUN_AS_NODE` in the Playwright config or fixture before launching, and do not pass it in `env`. This can bite when tests run from inside another Electron-based tool.
- If launch times out, check that the `EnableNodeCliInspectArguments` fuse is not off (Playwright docs).
- **Fake backend:** `page.route` only sees renderer traffic, and your Slack calls happen in main. So make the base URLs configurable with env vars (`JUNO_SLACK_API_URL`, websocket URL, OpenRouter base URL) and point them at a local fake server started in a Playwright fixture (a small `node:http` + `ws` server, or MSW in node). Make the fake emit real Slack payload shapes (decode them through your Schemas, so the fake and the app stay in sync). Replace the Slack service layer with a test layer only for unit tests; keep the real client in e2e.
- Give each test its own temp user-data dir and DB (`--user-data-dir`, or an env var your app reads) so runs do not share state or the Keychain.
- Hide windows in tests: create the `BrowserWindow` with `show: false` when `JUNO_E2E=1`. Playwright still clicks and reads fine (tested: `isVisible()` was `false` and the click worked). Use `win.screenshot()` for visual checks.
- Disable animations with a test-only CSS flag or `prefers-reduced-motion` so assertions are not racy. Use `electronApp.evaluate` for main-process checks such as menus or `webContents` state. Native `Menu.popup` menus are not in the DOM, so test the menu template in main (`Menu.getApplicationMenu()` or an exposed hook) rather than clicking it.
- Use `trace: 'retain-on-failure'` and `video` only on CI.

**CI on macOS:** GitHub-hosted macOS runners have a window server, so no `xvfb` is needed. `macos-latest` is currently **macOS 26 arm64** (`macos-26`). `macos-15` and `macos-15-intel` also exist; `macos-14` is deprecated. The Electron docs' headless note is about Linux (use `xvfb-run`). Steps: install, build, `npx playwright test`. Playwright's browser download is not needed because Electron is the browser, so skip `playwright install`.

**Recommendation:** Use `_electron.launch` against the built app in `out/`, with env-var-configurable endpoints pointing at a local fake Slack/OpenRouter server, a temp data dir per test, `show: false`, and a macOS-26 arm64 runner in CI. Strip `ELECTRON_RUN_AS_NODE`.

Sources:
- https://playwright.dev/docs/api/class-electron
- https://www.electronjs.org/docs/latest/tutorial/automated-testing
- https://github.com/actions/runner-images (README label table)

---

## 7. Package manager

**Facts**
- Node 25+ does not ship Corepack (the Corepack README: "distributed with Node.js from version 14.19.0 up to (but not including) 25.0.0"). With Node 26, `corepack` is not on PATH here. To use it: `npm install -g corepack`, then `corepack enable`. Otherwise install pnpm directly (`npm i -g pnpm`, Homebrew, or pnpm's standalone installer).
- pnpm is not installed on this machine. Current: **pnpm 12.11.2**. Bun here is 1.3.10.
- **Bun 1.3 workspaces** use the isolated linker by default for new workspaces (a `node_modules/.bun` store, like pnpm). Older projects and npm/yarn imports stay hoisted. Switch with `linker = "hoisted"` in `bunfig.toml`. My StyleX + Vite 8 workspace built fine under bun (tested).
- Bun skips dependency lifecycle scripts unless the package is in `trustedDependencies`. After `bun add electron` the postinstall did not run, but the `electron` CLI downloaded its binary on first run anyway (tested). Anything else with an install script (for example a native module) needs an explicit allow.
- pnpm's equivalent is `onlyBuiltDependencies` (I did not verify pnpm's current default for build scripts).
- **Native modules:** with `node:sqlite` (section 3) Juno has no native module to rebuild, which removes the main reason to be careful. If you later add better-sqlite3 or similar, you need `@electron/rebuild` (4.2.1) or electron-builder's own rebuild, plus asar unpacking, under either manager.
- electron-builder 26.15.3 has dedicated pnpm and bun node-module collectors (checked in `app-builder-lib` source). electron-vite and Forge are most commonly used and documented with npm and pnpm.

**Comparison for this repo**

| | pnpm | bun |
| --- | --- | --- |
| Workspaces and `workspace:*` | Mature, catalogs, `--filter` | Works, isolated store by default |
| Strictness | Strict by default | Strict for new workspaces |
| Install speed | Fast | Faster |
| Native module / lifecycle scripts | `onlyBuiltDependencies` | `trustedDependencies` |
| Electron tooling coverage | Most docs, issues and CI recipes | Less tested; builder has a collector |
| Already installed | No | Yes |

**Recommendation:** Use **pnpm 12** for the monorepo, installed with `npm i -g pnpm` (or Homebrew) and pinned in `package.json` `"packageManager"` for reproducibility. Reasons: it is the best-trodden path for Electron packaging in a monorepo, its strict layout catches missing dependency declarations in your many small packages, and `workspace:` and catalogs fit that structure. Bun is a reasonable second choice because you have no native modules and it already works here; if you pick it, add `trustedDependencies` entries up front and keep `electron-builder` on its bun collector. Either way, do not rely on Corepack. I did not run a pnpm install or an electron-builder package in this research.

Sources:
- https://github.com/nodejs/corepack#readme
- https://bun.com/docs/pm/isolated-installs
- https://bun.com/docs/install/lifecycle
- npm registry metadata for pnpm and `app-builder-lib@26.15.3`

---

## 8. Fonts

**Free fonts as npm packages** (all version 5.3.0, license **OFL-1.1**, which allows bundling and redistributing in an app):
- `@fontsource-variable/inter`: Inter as a variable font (family name `Inter Variable`, weights 100 to 900). `index.css` imports all subsets, with `unicode-range` so only the needed `woff2` files load. Subpaths: `wght.css` (default) and `opsz.css` (adds the optical size axis, giving the "Display" design at large sizes). The latin file is about 48 KB.
- `@fontsource/inter`: static weights, one import per weight (`400.css`, `600.css`). Use this only if you need fixed faces.
- `@fontsource/instrument-serif`: static `400` regular and italic only (family name `Instrument Serif`). The latin `woff2` is about 21 KB. There is no variable build and no other weights, so do not ask the design for bold.
- Import once in the renderer entry: `import '@fontsource-variable/inter/wght.css'` and `import '@fontsource/instrument-serif/400.css'` (plus `400-italic.css` if used). Vite bundles the `woff2` files into the app, so it works offline and with a strict CSP (`font-src 'self'`).
- Inter features useful for a chat UI: `tnum` (tabular numbers for timestamps), `cv11` (single-storey a), `ss03` (round quotes and commas). Enable with `font-feature-settings`.
- Put the family names in the tokens file: `sans: '"Inter Variable", system-ui, sans-serif'` and `serif: '"Instrument Serif", serif'` (the tested tokens build used exactly these).

**SF Pro / `system-ui` on macOS**
- `font-family: system-ui` (or `-apple-system`) renders as SF on macOS. It matches native apps and automatically switches optical size, and it costs 0 KB.
- You **cannot bundle SF Pro**. Apple's license (developer.apple.com/fonts) allows it for mock-ups and Apple-platform apps only, and says you may not embed the font in software or use it on non-Apple platforms.
- Trade-offs: `system-ui` gives a native feel on Mac but looks different on Windows (Segoe UI) and Linux, and font metrics (and so line wrapping and screenshots) change between OS versions, which makes visual tests less stable. Inter is a close lookalike of SF, is identical on every OS, has `tnum` and `cv` features, and is what the design handoff probably assumed.

**Recommendation:** Bundle `@fontsource-variable/inter` (use `opsz.css` if you want display sizes to look sharper) and `@fontsource/instrument-serif` 400. Put `system-ui` after Inter as the fallback only. This gives identical rendering for design review and Playwright screenshots, and OFL-1.1 lets you ship the files. Revisit native `system-ui` only if you decide Juno should feel strictly Mac-native.

Sources:
- https://fontsource.org/docs/getting-started/install
- https://www.npmjs.com/package/@fontsource-variable/inter
- https://www.npmjs.com/package/@fontsource/instrument-serif
- https://rsms.me/inter/
- https://developer.apple.com/fonts/

---

## 9. Lucide icons for React

- Package: **`lucide-react` 1.55.0** (ISC license; peer React 16.5 to 19). Version 1.x is current.
- Usage: `import { Send, Hash } from 'lucide-react'` then `<Send size={16} strokeWidth={1.75} />`. Props: `size`, `color`, `strokeWidth`, `absoluteStrokeWidth`. Icons use `currentColor`, so they follow the CSS `color` property (also a StyleX token).
- **Tree shaking:** `"sideEffects": false` with ESM output (`dist/esm/lucide-react.mjs`) and one module per icon (4,282 files in `dist/esm/icons`), so only the icons you import are bundled (the docs say the same). Avoid the dynamic icon component (`DynamicIcon`) and `import * as icons`, which pull in the whole set.
- Accessibility: icons render as inline SVG. Decorative icons should stay `aria-hidden`; icon-only buttons need an `aria-label` on the button.
- Tip for many small packages: wrap the handful you use in one `@juno/icons` package that re-exports named icons with the project's default size and stroke, so the set is easy to change.

**Recommendation:** Use `lucide-react` with named imports, wrapped in a single icons package.

Sources:
- https://lucide.dev/guide/packages/lucide-react
- https://www.npmjs.com/package/lucide-react
