# Desktop e2e

The app's end-to-end tests, against the fake Slack server. Fixtures, `launchApp` and the options a file can `test.use` are in `fixtures.ts`; the page objects are in `driver/`. Setup, commands and the remote runner are in `docs/development.md`.

## Sidebar trace

A sidebar test that fails because a row did not appear, or did not move, needs to say whether the sidebar held its order or was given no new list. The sidebar trace records both.

- **On:** `test.use({ sidebarTrace: true })` in a spec file, or `launchApp(dir, { sidebarTrace: true })`. The sidebar specs (`automated`, `automated-record`, `sidebar`, `sidebar-hold`, `sidebar-preview`, `views`, `layout-shift`) have it on. The fixture puts an empty `globalThis.__junoSidebarTrace` on the main window, which turns the recording on (`packages/state/src/sidebarTrace.ts`).
- **Off:** the app records nothing. A change of the hold's inputs costs one property read, and a topic list value another.
- **What it records:**
  - `hold`: the last 60 changes of the order hold's inputs (SPEC 5, "Holding the order"). Each entry names the change (`list entered (pointer true, keyboard false)`, `left`, `sheet opened`, `sheet closed`, `flushed`, `resumed`, `released a topic`) and the state at that moment: `engaged`, `paused`, `sheets` (open sheets) and `released` (topics shown at once while held). `list entered` and `list left` come from the list itself, before the hold takes them in; the entry after says what changed. The list holds while `engaged || sheets > 0`, unless `paused`.
  - `list`: how many topic list values the sidebar was given (`values`), how many said the engine's run failed (`errors`), and the last of each (`seq`, row count, filter, error).
- **When a test fails:** the `running` fixture attaches the trace as `sidebar-trace` and prints it on one line, `sidebar trace (<test>): {...}`, so a remote run's `run.log` has it.

Reading it: a row that never appeared with the hold still on (`engaged` or `sheets > 0` and not `paused` in the last entry) points at the hold. A `list.last` older than the change the test made, or a rising `errors`, points at the engine's `topics.list`.
