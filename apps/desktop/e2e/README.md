# Desktop e2e

The app's end-to-end tests, against the fake Slack server. Fixtures, `launchApp` and the options a file can `test.use` are in `fixtures.ts`; the page objects are in `driver/`. Setup, commands and the remote runner are in `docs/development.md`.

## Scheduling and setup timings

Ordinary fake-Slack launches use the engine unit harness's 1:20 scheduling scale. The engine host accepts it only with both e2e mode and a fake Slack URL; a normal launch keeps production defaults. `test.use({ timing: 'production' })` or `launchApp(dir, { timing: 'production' })` keeps real timing for a test of a window itself. Presence-spacing checks and the reaction-versus-edit-backoff check opt out. Paced sync launches, `perf.spec.ts`, `idle-cpu.spec.ts`, feel scenarios and tests tagged `@mac` keep production timing automatically.

For a negative AI or Automated assertion, `await juno.workPass('title' | 'art' | 'home' | 'automated')` requests a pass through the job's existing serial consumer. The engine acknowledges only a pass started after that request, including a pass that chooses not to call the model. It fails after 10 seconds instead of accepting an unfinished pass. AI jobs still need `aiJobs: true`.

`pnpm remote --env JUNO_E2E_TIMINGS=1 test:desktop <specs>` prints separate fake-start, Electron-launch, sign-in, sync-wait and close durations in milliseconds. These are setup observations, not the Mac performance budgets. Each test still owns its fake and user-data directory; no signed-in profile is shared.

## Sidebar trace

A sidebar test that fails because a row did not appear, or did not move, needs to say whether the sidebar held its order or was given no new list. The sidebar trace records both.

- **On:** `test.use({ sidebarTrace: true })` in a spec file, or `launchApp(dir, { sidebarTrace: true })`. The sidebar specs (`automated`, `automated-record`, `sidebar`, `sidebar-hold`, `sidebar-preview`, `views`, `layout-shift`) have it on. The fixture puts an empty `globalThis.__junoSidebarTrace` on the main window, which turns the recording on (`packages/state/src/sidebarTrace.ts`).
- **Off:** the app records nothing. A change of the hold's inputs costs one property read, and a topic list value another.
- **What it records:**
  - `hold`: the last 60 changes of the order hold's inputs (SPEC 5, "Holding the order"). Each entry names the change (`list entered (pointer true, keyboard false)`, `left`, `sheet opened`, `sheet closed`, `flushed`, `resumed`, `released a topic`) and the state at that moment: `engaged`, `paused`, `sheets` (open sheets) and `released` (topics shown at once while held). `list entered` and `list left` come from the list itself, before the hold takes them in; the entry after says what changed. The list holds while `engaged || sheets > 0`, unless `paused`.
  - `list`: how many topic list values the sidebar was given (`values`), how many said the engine's run failed (`errors`), and the last of each (`seq`, row count, filter, error).
- **When a test fails:** the `running` fixture attaches the trace as `sidebar-trace` and prints it on one line, `sidebar trace (<test>): {...}`, so a remote run's `run.log` has it.

Reading it: a row that never appeared with the hold still on (`engaged` or `sheets > 0` and not `paused` in the last entry) points at the hold. A `list.last` older than the change the test made, or a rising `errors`, points at the engine's `topics.list`.

## Send trace

A test that sends from Home and then misses the message in a tab needs to say where the message got to. The send trace records the send's path through the renderer.

- **On:** `test.use({ sendTrace: true })` in a spec file, or `launchApp(dir, { sendTrace: true })`. `break-pass-1017` and `home-send-tab` have it on. The fixture puts an empty `globalThis.__junoSendTrace` on the main window, which turns the recording on (`packages/state/src/sendTrace.ts`).
- **Off:** the app records nothing. Each traced point costs one property read.
- **What it records**, the last 120 entries, each with `at` (`Date.now()`), ids, states and counts, never message text:
  - `send asked` and `send answered`: the send command (`sendMessage` in `@juno/state`), its target, the first 8 characters of its `clientMsgId`, and the topic it answered with.
  - `background`, `background opened` and `background window`: Home's open of the topic behind it (`openTopicInBackground`), with `reused` when a tab already showed it.
  - `switch`, `tabs asked`, `tabs applied` and `tabs dropped`: a tab change the navigation was asked for, with its ticket, the one it applied (the active tab after it), and one a newer change replaced.
  - `tab mounted` and `tab unmounted`: a tab's topic view.
  - `window`: each new message window a topic view got (`view` is `<topic>@<tab>`): its `seq`, row count, newest row, the spec, and in `sent` each of the last rows sent from this app as `<clientMsgId>:<sending|failed|stored>:<ts or pending>`.
- **When a test fails:** the `running` fixture adds the fake's `chat.postMessage`, `conversations.open`, `chat.update` and `chat.delete` calls (`posts`: time, method, channel, answer) and attaches the whole as `send-trace`, and prints it on one line, `send trace (<test>): {...}`, so a remote run's `run.log` has it.

Reading it: no `posts` entry for the channel means the send never left the engine. A `window` for the tab's view whose `sent` stays at `pending` while `posts` shows an answer points at the engine's reconcile. No `window` for the tab's view after the send means its subscription did not run again. A `tabs dropped` or no `tabs applied` with the tab active after `switch` means the tab never showed.

## Relaunch frames

The relaunch check in `session.spec.ts` attaches `relaunch-frames` JSON before its assertions. It records the total frames, sidebar and sign-in counts, and each frame without a sidebar. Each missing frame includes its index, time since navigation, root child count, whether an earlier sample had the sidebar, and whether the bundle and shell-paint marks exist. `hadShell: false` with an empty root identifies a gap before the first shell. `hadShell: true` identifies a later disappearance. The test still requires the sidebar in every sampled frame and no sign-in frame.

Check the failing run's commit before diagnosing a new startup regression. Worktrees created before `fd8ae4f7` can still run the old delayed initial render after that fix lands on main.

## Heavy tests

A test that is slow because of what it checks, and whose code rarely changes, is tagged `@heavy` and its area's tag: `test('...', { tag: ['@heavy', '@heavy-sync'] }, async () => ...)`. `HEAVY_AREAS` in `scripts/test-areas.mjs` lists the areas and the files each covers; add a file there when a heavy test starts to cover it. `pnpm affected` skips an area's heavy tests unless the change is in that area, by setting `JUNO_SKIP_TAGS`; the scheduled full run and a run by hand keep them. See `docs/development.md`, "Affected tests".
