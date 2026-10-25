# DOM lane

User flows that check what the app shows and what it sends, with no layout, under `bun test`. Each test runs the real renderer bundle in a [happy-dom](https://github.com/capricorn86/happy-dom) window against the real engine host and a fake Slack. A test costs about a third of the browser lane's CPU. Which lane a test belongs in is in [the e2e README](../e2e/README.md#which-lane).

## The rule

Assert on what the user sees (text, attributes, counts, focus) and on what reaches the fake. Never assert on boxes, positions, scroll or computed styles: there is no layout, every box is zero, and StyleX's sheet is built without `@layer`, so the cascade differs from the app's. A test that needs a polyfill to pass is about a browser feature and belongs in Playwright.

`window.ts` fills the gaps the app needs to run (animations finish at once, `checkVisibility` answers from `hidden` and inline `display`, `:focus-visible` follows the last input, a `MessageChannel` made of the window's own event targets). None of them is a thing to test here.

## What runs

- **The app.** `vite.config.ts` bundles the browser lane's page entry (`web/page/main.ts`) into one classic script; `bun web/build-host.mjs dom/dist` bundles the host (`web/host/testHost.ts`). Both go to `dom/dist/` through `build-cached` (`bun run build:dom` in `apps/desktop`). Each test gets a new window, a new fake Slack, a copy of the synced snapshot and a host from the worker's pool (`app.ts`). The renderer's module state is new for every window.
- **Synced start.** One snapshot per run, shared by every worker through the browser lane's lock (`e2e/browser/snapshotCache.ts`), signed in through happy-dom. A test starts where `juno.signIn()` and `juno.waitForSync()` leave it. `domTest(title, body, { synced: false })` starts signed out on an empty folder.
- **Workers.** `bun test --parallel --no-isolate`: a worker keeps its compiled renderer and its pool of loaded hosts for the whole run. Files run in a shuffled order whose seed `test:dom` prints.

## Writing a test

```ts
import { expect } from './expect'
import { domTest } from './test'

domTest('a refused send stays with Retry', async ({ juno, fake, slack, step }) => {
  await juno.sidebar.row('#eng').open()
  fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 1 })
  await juno.topic.send('Please try this one again')
  await expect(juno.topic.failed('Please try this one again').row).toContainText('Not sent.')
})
```

`domTest` gives the body `juno` (the driver), `fake`, `slack` (`e2e/driver/slack.ts`), `app`, `userData`, `clock`, `model`, `relaunch`, `otherApp` (a second app on its own folder against the same fake and model, signed out, as another Mac) and `step`. Options: `synced`, `engine` (the host's `EngineOptions`), `clock`, `model` (a function that starts the model the agent talks to; the agent then runs) and `timeout` (default 60 s).

- **Driver.** `driver/` has the Playwright driver's page objects with the same verbs (`e2e/driver/verbs.ts`; both drivers implement it, so a renamed verb fails the typecheck in both): `juno.sidebar` (with views and their sheet), `.tabs`, `.topic` (with thread links, the switcher and Follow), `.write` (Home's composer), `.home` (with a card's review sheet), `.welcome`, `.palette`, `.settings`, `.notifications`, `.accountMenu`, `.nav`, `.surface` (an `AppSurface`, as the web surface is), `searchPage(juno.win)` and the agent's `openChat`, `openPage`, `openSettings`, `openRuns`, `addServer`, `configure`, `card` and the chat's `menu`, `reply` (`driver/agent.ts`).
- **Queries.** `Query` (`query.ts`) is shaped like Playwright's Locator: `locator`, `getByRole`, `getByText`, `getByLabel`, `getByTitle`, `filter`, `first`, `nth`, `parent`, `and`, `or`, and actions that wait for a shown element (`click`, `hover`, `fill`, `press`, `pressSequentially`, `check`). Roles and names follow Playwright's rules near enough: a string name matches a substring, ignoring case; `exact` asks for the whole name. `juno.win` is the page (`Dom`, `input.ts`), with `win.keyboard.press('Meta+Enter')`.
- **expect.** `expect(query)` has Playwright's assertions (`toBeVisible`, `toHaveCount`, `toHaveText`, `toContainText`, `toHaveAttribute`, `toHaveValue`, `toBeFocused`, `toBeDisabled`, `toHaveAccessibleName`, with `.not`), each polled for 5 s unless given `{ timeout }`. Any other value goes to Bun's `expect`. `expect.poll(fn)` polls.
- **Visible** means in the document and not under `hidden`, `inert`, `aria-hidden` or an inline `display: none` (React's Activity hides tabs that way). Style sheets do not hide anything here.
- **Menus** go through the page's test seam, as in the browser lane: `juno.chooseNextMenuItem(id)` then the right-click, or a row's `chooseInMenu(id)`; app-menu items with `juno.tabs.menu(id)` or `juno.surface.appMenu(id)`.
- **Clock.** `domTest(..., { clock: true })` installs a test clock before the page loads (`clock.ts`, Playwright's semantics): time flows until the test moves it; `clock.fastForward(ms)` jumps and fires each due timer once, `runFor` fires every timer in order, `pauseAt`, `resume`, `setFixedTime`. The engine's Effect clock follows each jump (`web/host/clock.ts`), so a wait in the engine, such as a slow fake model (`engine: { fakeAiDelayMillis }`), passes with the page's. The page's engine socket keeps real time.
- **Agent.** `model: () => startScriptedModel({ answer })` (`e2e/juno-agent/model.ts`) runs the agent against it; wait for it with `readySynced(juno)`.
- **Waiting.** Wait for the thing, as everywhere (`docs/development.md`, "Rules for tests"). The sidebar's filters wait for the engine's list for the new filter (the sidebar trace is always on here). This lane runs faster than a browser, so a step the browser's slowness used to cover now races: after an open, wait for the new title before typing or pressing in the topic, or the step lands in the topic still on screen.
- **Marks.** `juno.lastMark(name)` and `juno.lastMeasure(name)` read the app's performance marks. The worker's `performance` is shared by every window it opens, so compare with the value read before the step.

## Porting a Playwright test

1. Pick a test the inventories mark `dom`, in a spec no one else is editing. Copy it to `dom/<spec name>.test.ts` (keep `juno-agent/` as a folder).
2. Change the imports: `expect` from `./expect`, `domTest` from `./test`, helpers from `./driver/...`. `test(...)`/`syncedTest(...)` becomes `domTest(...)`; `test.step` becomes the `step` the body gets; `win.clock` becomes `clock` with `{ clock: true }`; `relaunch()` returns the new driver, and `relaunch({ tour: true })` opens a page that shows the welcome card by itself.
3. Leave out what is layout: `boundingBox`, `scrollIntoViewIfNeeded`, `toHaveCSS`, mouse coordinates, `measureLayoutShift`, `getAnimations`. If the test is mostly that, it stays in Playwright; if one check is, move that check to the gallery or keep it in the browser test it belongs to.
4. Run it: `bun run remote test:dom --files apps/desktop/dom/<file>.test.ts`. A failed test saves its page as HTML in `apps/desktop/test-results/dom/`, which the remote run brings back under `.remote/<run>/`. `JUNO_DOM_DEBUG=1` passes the page's whole console through.
5. Show it can fail: break the code it guards (return early, flip a condition) and see it fail, then put the code back.
6. Delete the Playwright test once the port passes and asserts the same behaviour, and the spec file when it is empty (remove it from `e2e/lanes.ts` too).

## Measured

10-25, SSH laptop, 2 physical cores (4 threads), one run each, builds cached. The 14 tests ported first (`git log -- apps/desktop/dom`):

| | Playwright browser lane, 4 workers | DOM lane, 4 workers | DOM lane, 1 worker |
| --- | ---: | ---: | ---: |
| Test step wall | 26.5 s | 15.8 s | 17.9 s |
| CPU per test | 4.3 s | 3.9 s (2.6 s over 42 runs) | 2.4 s (about 2.0 once warm) |
| Wall per test | 5.3 s | 4.2 s | 1.0–1.9 s |

The agent's flows (`juno-agent/`, 10-25, same laptop, one run each, 4 workers): 40 browser tests took 73 s of script time; after the move, 29 DOM tests take 37 s and the 12 browser tests left take 40 s.

A worker's first test pays for the host's fork and the renderer's compile (about 1.5 CPU-s), so a short run at many workers costs more per test than a long one. At four workers on four threads the job is CPU-bound (99% busy at the median).

## Commands

- `bun run test:dom` (`scripts/dom-tests.mjs`): builds `dom/dist/` if its inputs changed, then every file. `--files <repo paths>` runs those; `--seed <n>` repeats an order. `JUNO_DOM_WORKERS` sets the workers (default `JUNO_TEST_WORKERS`, one per allocated thread on the runner). Locally it waits for the heavy-job slot; run it remotely: `bun run remote test:dom`.
- `JUNO_E2E_TIMINGS=1` prints a `dom timing:` line per test: wall time and CPU milliseconds of the Bun worker (test, fake, renderer) and of the hosts it forked (engine, agent), for the snapshot wait, the start and the body.
- `bun run affected` runs the DOM files a change reaches through the import graph, with the renderer and host entries counted as each file's imports; `verify:main` runs the whole lane as its own suite, in the unit job.
