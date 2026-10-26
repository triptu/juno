# DOM lane

User flows that check what the app shows and what it sends, with no layout, under `bun test`. Each test runs the real renderer bundle in a [happy-dom](https://github.com/capricorn86/happy-dom) window against the real engine host and a fake Slack. A test costs about a third of the browser lane's CPU. Which lane a test belongs in is in [the e2e README](../e2e/README.md#which-lane).

## The rule

Assert on what the user sees (text, attributes, counts, focus) and on what reaches the fake. Never assert on boxes, positions, scroll or computed styles: there is no layout, every box is zero, and the window gets only the sheet's root rules (the tokens), so an element's computed style is mostly the default. A test that needs a polyfill to pass is about a browser feature and belongs in Playwright.

Found while porting, and so left in the browser lane:

- **⌘Z after an edit the app made.** The app edits fields through `document.execCommand` so ⌘Z undoes: suggestion picks (emoji, mentions), ⌘B and ⌘I, keys typed on Home's chips and keys held after ⌘T. `window.ts` runs `insertText` and `delete` as Chromium does on a textarea (the selection replaced, the caret after it, one `input`), so those flows run here, but it keeps no undo stack: a check that ⌘Z takes such an edit back stays in Playwright.
- **Images loading.** An image that shows once it has loaded, or falls back when it fails, never does either here.
- **When idle work runs.** `requestIdleCallback` runs almost at once here, so a check that something has not happened yet before idle time (Home's first picture) does not hold.
- **Focus that follows Chromium's events.** Esc in Home's destination search ends on the chip in Chromium and on the field here; a mouse press on a tab differs too.

`window.ts` fills the gaps the app needs to run (`execCommand`'s `insertText` and `delete` on the focused field, animations finish at once, `checkVisibility` answers from `hidden` and inline `display`, `:focus-visible` follows the last input, `:hover` follows the element `Dom.hover` last moved onto, `document.hasFocus()` follows the window's `focus` and `blur`, a `MessageChannel` made of the window's own event targets, `window.event` set while listeners run, so React treats a keydown or click from a native listener as discrete, as in a browser). None of them is a thing to test here. The page's sockets are Bun's: `closeWindow` closes them with the page, and a closed page cannot open another, so it cannot reach the next test's host on the pooled host's port.

happy-dom's element classes are shared by every window in a worker. `window.ts` patches them once, and puts them back as they were before each page runs and after the last one closes, since a page patches them as its own (`web/page/urls.ts` wraps `setAttribute`). Without that, each test wrapped the last one's patch and kept every closed window alive, about 35 MB a test, until a full lane ran out of memory. A new patch to a shared prototype goes in `patchPrototypes`, never in `fillGaps`, which runs per window.

The window has only the root rules of the StyleX sheet (`:root`, `html`: the tokens, such as the durations `rootDuration` reads). happy-dom matches every rule against an element and its ancestors on each `getComputedStyle`, which the app calls in layout effects; with the whole sheet that was an eighth of the worker's CPU, for values that need layout to mean anything.

The renderer runs in one VM context per worker, not in each window's own (`realm.ts`). JSC keeps compiled and optimised code per context, so in a new context per test React and Effect ran cold every time. The bundle is compiled as one function in the worker's context, and each window calls it: the modules start new, as on a page load, and each global the bundle names (`document`, `setTimeout`, `fetch`, `globalThis`) is a variable bound to that window's value, so a closed page's late callbacks reach only its own window and `otherApp` runs beside it. A global the page replaces later (`urls.ts` sets `window.fetch`) is followed; one it adds is read as `window.name`. JavaScript's own globals (`Array`, `Uint8Array`) are the shared context's, on the window too, except one the test replaced (the clock's `Date`). What the shared context holds itself is checked when each window closes: a property added, removed or replaced on a JavaScript object or prototype (`Array.prototype`, `Error.stackTraceLimit`), or on its global through a sloppy `this`, fails the test that left it, and the worker starts a new context for the tests after.

A list drawn as it scrolls (the emoji picker's cells, All topics' table) draws nothing here, since every box is zero: a test of its rows stays in Playwright.

## What a test guards

A test here guards something a person would notice breaking: sending, editing, deleting and reacting (and that a send goes once), reading and read marks, notifications, search, ⌘K, navigation and tabs, the Juno agent's actions and approvals, sign-in and the first sync, or a bug that happened. Copy, labels, counts and exact menu lists are not tested here. Tests that start on the same screen are one journey with `step`s: a start costs about 0.55 CPU-s, more than most steps. A step leaves the screen as the next one expects it, or the next one resets it (closing every tab leaves one Home). Each check compares with what the step itself did, not with totals since the start. Start synced and change the fake after the start; sign in cold (`synced: false`) only when sign-in or the first sync is what the test checks, or when the AI jobs need it. A check of engine logic with no screen in it belongs in an engine flow test. The list of what the strict pass of 10-26 cut and merged, and the break that shows each journey still fails, is in `/Volumes/AgentWork/juno-test-overhaul/strict-dom.md`.

## What runs

- **The app.** `vite.config.ts` bundles the browser lane's page entry (`web/page/main.ts`) into one classic script; `bun web/build-host.mjs dom/dist` bundles the host (`web/host/testHost.ts`). Both go to `dom/dist/` through `build-cached` (`bun run build:dom` in `apps/desktop`). Each test gets a new window, a new fake Slack, a copy of the synced snapshot and a host from the worker's pool (`app.ts`). The renderer's module state is new for every window; its compiled code is the worker's (`realm.ts`, above).
- **Synced start.** One snapshot per run, shared by every worker through the browser lane's lock (`e2e/browser/snapshotCache.ts`), signed in through happy-dom. A test starts where `juno.signIn()` and `juno.waitForSync()` leave it. `domTest(title, body, { synced: false })` starts signed out on an empty folder; add `fake` (the fake's `FakeSlackOptions`, such as `{ seed }`) for a seed of its own.
- **Workers.** `bun test --parallel --no-isolate`: a worker keeps the renderer's context and its pool of loaded hosts for the whole run. Files run in a shuffled order whose seed `test:dom` prints.

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

`domTest` gives the body `juno` (the driver), `fake`, `slack` (`e2e/driver/slack.ts`), `app`, `userData`, `clock`, `model`, `relaunch`, `otherApp` (a second app on its own folder against the same fake and model, signed out, as another Mac) and `step`. Options: `synced`, `fake` (with `synced: false`), `engine` (the host's `EngineOptions`), `clock`, `counted` (the engine's frames reach the page one at a time and `Math.random` is seeded, for counted budgets: `work.ts`, `docs/performance.md`, "Counted budgets"), `model` (a function that starts the model the agent and the engine's AI talk to; the agent then runs, unless `engine: { agent: false }`) and `timeout` (default 60 s).

- **Driver.** `driver/` has the Playwright driver's page objects with the same verbs (`e2e/driver/verbs.ts`; both drivers implement it, so a renamed verb fails the typecheck in both): `juno.sidebar` (with views and their sheet), `.tabs`, `.topic` (with thread links, the switcher and Follow), `.write` (Home's composer), `.home` (with a card's review sheet), `.welcome`, `.palette`, `.peek`, `.privacy` (whether `data-sensitive` text sits under `data-privacy`), `.settings`, `.notifications` (with the hours rows), `.accountMenu`, `.nav`, `.surface` (an `AppSurface`, as the web surface is), `searchPage(juno.win)` and the agent's `openChat`, `openPage`, `openSettings`, `openRuns`, `addServer`, `configure`, `card` and the chat's `menu`, `reply` (`driver/agent.ts`).
- **Queries.** `Query` (`query.ts`) is shaped like Playwright's Locator: `locator`, `getByRole`, `getByText`, `getByLabel`, `getByTitle`, `filter`, `first`, `nth`, `parent`, `and`, `or`, and actions that wait for a shown element (`click`, `hover`, `fill`, `press`, `pressSequentially`, `check`). Roles, names and text are matched in `find.ts`, by walking happy-dom's own child arrays (the page changes between most polls, so happy-dom's selector cache misses and its engine costs several times as much). Roles and names follow Playwright's rules near enough: a string name matches a substring, ignoring case; `exact` asks for the whole name. `juno.win` is the page (`Dom`, `input.ts`), with `win.keyboard.press('Meta+Enter')`, and `win.keyboard.down('Alt')` and `up` for a held key (a row's `peek()`). A `<select>` takes `selectOption(value)`.
- **expect.** `expect(query)` has Playwright's assertions (`toBeVisible`, `toHaveCount`, `toHaveText`, `toContainText`, `toHaveAttribute`, `toHaveValue`, `toBeFocused`, `toBeDisabled`, `toHaveAccessibleName`, with `.not`), each polled for 5 s unless given `{ timeout }`. Any other value goes to Bun's `expect`. `expect.poll(fn)` polls `fn`, soon at first and then every 100 ms.
- **Visible** means in the document and not under `hidden`, `inert`, `aria-hidden` or an inline `display: none` (React's Activity hides tabs that way). Style sheets do not hide anything here. A control the app keeps for the pointer only, out of the accessibility tree (See all on a reactions card, a presence dot), is checked with `toHaveCount` and pressed with `juno.win.click(query.all()[0]!)`.
- **Nothing happened.** A check that something did not appear passes at once if it is made before the app could have shown it. Anchor it on something that did happen (`slack.expectNoMarks()` after the row shows the new message), or give it a short wait with a comment.
- **Menus** go through the page's test seam, as in the browser lane: `juno.chooseNextMenuItem(id)` then the right-click, or a row's `chooseInMenu(id)`; app-menu items with `juno.tabs.menu(id)` or `juno.surface.appMenu(id)`.
- **Clock.** `domTest(..., { clock: true })` installs a test clock before the page loads (`clock.ts`, Playwright's semantics): time flows until the test moves it; `clock.fastForward(ms)` jumps and fires each due timer once, `runFor` fires every timer in order, `pauseAt`, `resume`, `setFixedTime`. The engine's Effect clock follows each jump (`web/host/clock.ts`), so a wait in the engine, such as a slow fake model (`engine: { fakeAiDelayMillis }`), passes with the page's. The page's engine socket keeps real time.
- **Agent.** `model: () => startScriptedModel({ answer })` (`e2e/juno-agent/model.ts`) runs the agent against it; wait for it with `readySynced(juno)`.
- **Waiting.** Wait for the thing, as everywhere (`docs/development.md`, "Rules for tests"). The sidebar's filters wait for the engine's list for the new filter (the sidebar trace is always on here). This lane runs faster than a browser, so a step the browser's slowness used to cover now races: after an open, wait for the new title before typing or pressing in the topic, or the step lands in the topic still on screen.
- **A slow engine.** `app.holdReplies('drafts.get')` holds the engine's replies to the RPCs the page asks for from then on (by route tag), and returns a function that delivers them in order (`socket.ts`). `topic.test.ts` holds a draft so a composer mounts after a key the user pressed.
- **Marks.** `juno.lastMark(name)` and `juno.lastMeasure(name)` read the app's performance marks. The worker's `performance` is shared by every window it opens; each test starts with its marks cleared, and a relaunch keeps them, so compare with the value read before the step.

## Porting a Playwright test

1. Pick a test the inventories mark `dom`, in a spec no one else is editing. Copy it to `dom/<spec name>.test.ts` (keep `juno-agent/` as a folder).
2. Change the imports: `expect` from `./expect`, `domTest` from `./test`, helpers from `./driver/...`. `test(...)`/`syncedTest(...)` becomes `domTest(...)`; `test.step` becomes the `step` the body gets; `win.clock` becomes `clock` with `{ clock: true }`; `relaunch()` returns the new driver, and `relaunch({ tour: true })` opens a page that shows the welcome card by itself.
3. Leave out what is layout: `boundingBox`, `scrollIntoViewIfNeeded`, `toHaveCSS`, mouse coordinates, `measureLayoutShift`, `getAnimations`. If the test is mostly that, it stays in Playwright; if one check is, move that check to the gallery or keep it in the browser test it belongs to.
4. Run it: `bun run remote test:dom --files apps/desktop/dom/<file>.test.ts`. A failed test saves its page as HTML in `apps/desktop/test-results/dom/`, which the remote run brings back under `.remote/<run>/`. `JUNO_DOM_DEBUG=1` passes the page's whole console through.
5. Show it can fail: break the code it guards (return early, flip a condition) and see it fail, then put the code back.
6. Delete the Playwright test once the port passes and asserts the same behaviour, and the spec file when it is empty (remove it from `e2e/lanes.ts` too).

## Measured

10-26, the strict pass: 148 tests in 81 files became 50 in 40. SSH laptop, 2 physical cores (4 threads), 4 workers, builds cached, `JUNO_E2E_TIMINGS=1`, one run before and two after with different order seeds:

| | Before | After |
| --- | ---: | ---: |
| Tests | 148 | 50 |
| `bun test` wall | 81 s | 52 s, 55 s |
| CPU per test, sum | 294 CPU-s | 191, 203 |
| CPU in test starts, sum | 98 CPU-s | 42, 43 |
| CPU per test, median | 1.8 s | 3.3, 3.8 s |

The bodies are now most of the lane: the longest journeys (⌘K, the composer, a topic, the instant paths) take 7–9 CPU-s each.

Earlier on 10-26, same machine and settings: the whole lane (147 tests in 81 files, 4 workers), before and after the renderer's shared context and `expect.poll`'s back-off; after, three runs with different order seeds:

| | Before | After |
| --- | ---: | ---: |
| Script time | 139 s | 91 s, 97 s, 91 s |
| `bun test` wall | 124 s | 91 s, 96 s, 90 s |
| CPU, whole job | 475 CPU-s | 338, 335, 324 |
| CPU per test, sum | 451 CPU-s | 338, 334, 330 |
| CPU per test, median | 2.8 s (Bun 1.9, host 0.9) | 1.9–2.1 s (Bun 1.1–1.2, host 0.9) |
| Bun in the test's start, median | 0.96 s | 0.46–0.47 s |
| Worker peak RSS | 0.6 GB | 0.6–0.8 GB |
| Container peak | 3.2 GB | 3.3–3.6 GB |

The host was not changed. Its CPU is the engine's own work: in a profile, running SQL is a fifth of it and the Effect fibers of sync and live queries most of the rest, while the engine's start and stop take about 25 ms a test. An engine kept booted between tests and reset to the snapshot would still do the warm catch-up the test starts after. The fake Slack starts in about 5 ms of CPU, so one per test stays.

10-25, SSH laptop, 2 physical cores (4 threads), one run each, builds cached. The whole lane after the four port batches (136 tests in 77 files, 4 workers), before and after the harness changes of `git log --grep 'DOM lane:' -- apps/desktop/dom/window.ts apps/desktop/dom/find.ts`, two interleaved runs each:

| | Before | After |
| --- | ---: | ---: |
| `bun test` wall | 128 s, 132 s (123 and 133 tests ran: workers died) | 103 s, 103 s |
| CPU per test, median | 3.6 s, 3.3 s (Bun 2.3–2.4, host 0.9–1.0) | 2.6 s, 2.7 s (Bun 1.7–1.8, host 0.9) |
| Worker peak RSS | 1.7 GB, 2.1 GB, growing every test | 0.5 GB, 0.7 GB |
| Container peak | 6.0 GB (the cap) | 3.2 GB, 3.5 GB |

Earlier, against Playwright, on the 14 tests ported first: 4.3 CPU-s per test in the browser lane, 3.9 at 4 workers in this lane before the changes above. The agent's flows (`juno-agent/`): 40 browser tests took 73 s of script time; after the move, 29 DOM tests take 37 s and the 12 browser tests left take 40 s. The browser specs i–r: 56 browser tests took 73 s; after the port, 15 stay in the browser (about 30 s) and 33 DOM tests run in 34 s.

Where a test's CPU goes now (an inspector profile of the Bun side, `JUNO_DOM_PROFILE=1`, 10-26): the renderer's code about a third, happy-dom a sixth, the harness's queries and polls and the fake Slack most of the rest; running the bundle's modules for a new window is about 60 ms. The host is over 40% of the total, nearly all warm catch-up (about 25 calls to the fake) and the test's own engine work.

A worker's first test pays for the host's fork and the renderer's compile (about 1.5 CPU-s); both start while the worker waits for the synced snapshot, and the renderer's code gets faster over the worker's first few tests. At four workers on four threads the job is CPU-bound (99% busy at the median). Three workers finish 42 runs in the same wall time with less CPU per test (hyperthreads share cores), five take longer; keep one worker per thread.

## Commands

- `bun run test:dom` (`scripts/dom-tests.mjs`): builds `dom/dist/` if its inputs changed, then every file. `--files <repo paths>` runs those; `--seed <n>` repeats an order. `JUNO_DOM_WORKERS` sets the workers (default `JUNO_TEST_WORKERS`, one per allocated thread on the runner). Locally it waits for the heavy-job slot; run it remotely: `bun run remote test:dom`.
- `JUNO_E2E_TIMINGS=1` prints a `dom timing:` line per test: wall time and CPU milliseconds of the Bun worker (test, fake, renderer) and of the hosts it forked (engine, agent), for the snapshot wait, the start and the body, and megabytes resident: the worker's peak and now, the hosts' now.
- `JUNO_DOM_PROFILE=1` runs in one process with no workers and writes CPU profiles of the Bun side (through the inspector, since `bun test` ignores `--cpu-prof`) and of each host to `test-results/dom-profile/`, which a remote run brings back.
- `bun run affected` runs the DOM files a change reaches through the import graph, with the renderer and host entries counted as each file's imports; `verify:main` runs the whole lane as its own suite, in the unit job.
