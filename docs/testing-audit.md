# Test suite audit, 10-18

What each suite costs, what it has caught, and what was changed to make it faster without losing protection. Branch `test-suite-audit`, from main at `76f87e74`. The rules that came out of it are in `docs/development.md`, "Testing", under "Rules for tests".

## 1. What a full run costs

`pnpm verify:main` runs one plan on one 8x16 machine in two lanes: the gallery and then the desktop e2e in one, and the unit tests and then the Quint check (no cache) beside them. The run takes as long as the slower lane.

Main at `76f87e74`, the same plan as `verify:main` (with a JSON reporter added), run on 10-18:

| Step | Script time | Tests | Summed test time |
| --- | --- | --- | --- |
| `test` (vitest, every package) | 215 s | 1,726 passed, 7 skipped | 430 s in the files that print a time |
| `specs:check`, no cache | 287 s | 266 Quint simulations, 19 Apalache checks, 15 typechecks | |
| `test:gallery` | 933 s | 304 passed, 1 failed | 2,675 s |
| `test:desktop` | 313 s | 474 passed, 40 skipped (`perf`, `screens`) | 1,419 s |
| Whole plan | 1,246 s | | |

The gallery's 933 s is one hang: the shift walk's state `RemoveCard/remove/click-then-working` took 791 s and the part timed out at 15 minutes. The same state hung the keeper's run on main earlier the same day (`.juno-status/verify-main/20261018T080214`). See section 4.1.

Without the hang, the lanes on main were close: unit tests then the uncached Quint check about 600 s, the gallery then the desktop e2e about 550 s (keeper runs of 10-17: 161 + 435 s against 215 + 334 s). So the side lane was the slower one, and unit-test time counts for the whole run, not only the app suites.

### 1.1 Where the time goes inside each suite

Desktop e2e, slowest spec files (summed seconds, tests) on main: `realtime` 91/10, `juno-agent/crash` 77/14, `send-checks` 54/17, `presence` 40/3, `break-pass-1017` 40/13, `layout-shift` 33/20, `tabs` 33/12, `quick-start` 32/3, `topic` 31/15, `juno-agent/states` 31/13. A test averages 3.0 s.

Gallery: the shift walk's 24 parts are 1,485 s of the 1,775 s outside the hang (84%), the focus-ring walk 115 s, `behaviour` 22 s, `trigger-open` 20 s (one test). Everything else is under 17 s per file.

Unit, slowest files: the engine's `slack-schedule` 55 s (6 tests), `sync` 54 s (49), `send` 36 s, `reads` 29 s, `actions` 26 s, `art` 26 s, `automated` 23 s, `ai-titles` 19 s; the agent's `recovery` 49 s and `backup-crash` 24 s. The engine files boot an engine against the fake Slack per test; `slack-schedule`, `automated`, `art` and `ai-titles` also slept in real time to show that nothing more happens.

### 1.2 Setup against flow in the desktop e2e

Measured with a probe spec run 20 times on one 8x16 machine at 5 workers (not committed): launching the app and closing it takes 0.63 s (median), `juno.signIn()` 0.69 s and `juno.waitForSync()` 0.69 s. A test that signs in pays about 1.9 s before its own first step. About three quarters of the desktop tests sign in, so setup is about 800 s of the suite's 1,419 s, a little over half. This is why merging small tests that share their setup saves time: each merged test saves about 1.9 s.

## 2. What failed in the last week, and why

From 249 remote run logs across the worktrees (75 desktop runs, 72 gallery runs since 10-15), the keeper's runs in `.juno-status/verify-main*` and the `ci-fix-*` entries and the keeper's notes (`.juno-status/ci-keeper.md`).

| Failure | Runs | Cause | Kind |
| --- | --- | --- | --- |
| Gallery shift walk, a part | 7 | 2 hangs on a press that changed the state (SettledReview on 10-17, RemoveCard on 10-18); the rest fonts, images and video controls measured before they settled (ci-fix-7, 20, 21) and the reduced-motion transitions (ci-fix-29) | 2 harness hangs, 4 harness, 1 real (toolbar flip under reduced motion) |
| `session.spec` relaunch flash | 6 | 2 of about 48 frames show no sidebar on a relaunch; cause not found | open flake in a named regression test; also failed once on this branch, unchanged |
| `app.spec` bridge keys, `palette-pages` sections, `engine.spec` URL | 2 + 1 + 1 | a feature changed a list the test pinned, and its branch did not run the spec | stale test |
| `memory-edit.spec` (gallery) | 2 runs, 5 tests | a branch's own work in progress | not on main |
| `source-link`, `stick-bottom` composer, `newchat` composer, `memory` card press, `chat-reactions` picker | 1 each | a lost jump before `drawnAll` (ci-fix-6), an older page replacing the bottom pin (ci-fix-11), a box read during a node swap (ci-fix-15), a card pressed while the chat scrolled (ci-fix-41), a deferred search (ci-fix-39) | 2 real bugs, 3 test races |
| `break-pass` Home send and new tab | rare | a hidden tab dropped a Home send; a new tab cancelled a topic open (ci-fix-36) | 2 real bugs |
| Unit: chat-cache bench, codex removal, title job races, backup purge marker | 1 to 3 each | timing under the plan's load (ci-fix-3, 5, 8), AI jobs racing tests (ci-fix-13, 14), digits in a marker | 1 real slowdown (ci-fix-8), the rest test races |
| Conformance replays | 10 of 40 loaded passes | rounds counted reached while the engine still worked (ci-fix-10) | harness |

What this says about usefulness: the tests that failed for real reasons were e2e tests of whole flows under load (source jumps, older pages, Home sends, new tabs, the welcome card's preference, the Juno send with an image) and the gallery's shift walk (the toolbar). No unit test of an implementation detail caught a bug this week; the unit failures were timing and races. The stale tests failed because a branch did not run the specs its change reached, not because the tests were wrong.

## 3. Coverage overlap

`apps/desktop/e2e/coverage-map.json` (main, `406e3956`) records which source files each of 103 spec files ran. It records files, not lines or branches, and almost every file is run by almost every spec: the median file in `engine`, `state`, `store`, `sync`, `domain`, `slack` and `ui` is run by 100 to 103 specs; in `views` by 12; in the agent by 38. 77 of 103 specs run no file that another spec does not also run. So the map cannot say that an e2e spec or a unit test is redundant: two specs that run the same files check different behaviour. Overlap was judged by reading the tests instead (section 4). The unit tests of pure rules cover branches the e2e cannot reach cheaply (every row of the sidebar placement table, every relative time), so file overlap is no reason to remove them.

## 4. What changed

Counts on one 8x16 machine, from the run logs:

| Suite | Before | After | Change |
| --- | --- | --- | --- |
| `test` (vitest) | 1,726 | 1,719 | 7 removed: duplicates and one merge |
| `test:gallery` | 305 | 281 | 24 dark-theme repeats of size checks |
| `test:desktop` (run) | 474 | 408 | 66 fewer launches; 2 tests removed, the rest merged with every assertion kept |
| `specs:check`, `specs:conformance` | unchanged | unchanged | kept without question |

### 4.1 Hangs

- **Shift walk (gallery).** `touch()` pressed each element, then focused it from the keyboard. A card that took its click disables its buttons, so the locator `button:not(:disabled)` no longer matched, and `locator.evaluate` waited for it until the part's 15-minute timeout. It now skips focus and blur when the press removed the element, and both give up after 5 s. On main this cost 791 s and a failed gallery run in every full run since the working card landed.

### 4.2 Waits

- **Unit.** `slack-schedule.test` slept 2.5 s sixteen times past the 1 s debounce; a test-only engine option (`slackScheduleDebounceMillis`) sets it to 200 ms and the waits to 0.9 s, except in the test of two quick changes making one write, which keeps the app's 1 s. `automated.test` waited 4 s three times past the 3 s window; `automatedWindowMillis` sets it to 300 ms there. `art.test`'s "does not ask again" slept 2 s and then checked nothing a second ask would break; it now counts the model's drawing calls around a later pass.
- **Gallery.** `openState` waited for every animation, capped at 600 ms, so every state with a spinner paid 600 ms in both walks; it now waits only for animations that end. `trigger-open` read each fill 200 ms after hover, 64 times; under reduced motion two frames are enough.
- **Desktop.** Fixed waits before a relaunch ("let the save reach the engine") poll `user.db` or `launch.json` for the saved value (`e2e/driver/userDb.ts`): tabs, navigation, send, views, the 10-17 break pass. `send-checks`' 6 s wait for a slow grammar answer waits for the stored answer. `peek` and `sidebar` wait for the replies page and `scrollend` instead of 300 ms.
- **Kept on purpose.** Waits that show nothing happens and have no signal to wait for: `mark-unread`'s stays past every read timer, `ai-key`'s three, `realtime`'s 429 storm, `presence`'s tickle windows, `idle-cpu`'s 20 s CPU window (performance.md), `automated` e2e's 4 s passes (a shorter window would change when the first sync's passes run), `ai-titles`' waits after a wake (the job titles the newest thread first, so a marker thread can be titled before the thread under test is looked at), and the waits for a model still answering in `send-checks` (the cache row is written only when it answers).

### 4.3 Merged desktop tests

Tests in one spec file that signed in and set up the same way and then checked one small thing each became one test of the journey, with `test.step('<old title>')` per old test, so a failure still names the old check. Order was chosen so that no step changes what a later one checks (fresh unread counts first, steps that post nothing before steps whose checks would see a post, a fresh baseline where a count is relative). Merges in 31 spec files; see the commits "Merge ..." on the branch. Not merged, because the setups or checks clash: `juno-agent/crash`, `transfer`, `quick-start`, `set-up`, the session import errors, layout-shift's cold-sync tests, `tool-approval` (exact MCP calls), the send-check fix lines (exact posts), `realtime`'s offline tests, `notifications`' dock badge, and the ⌘N tab tests.

### 4.4 Removed, with the reason

Desktop e2e:
- `topic.spec` "⋯ runs Rename…": every check is made by `actions.spec` "header rename".
- `notifications.spec` "Set yourself away and active…": its two menu checks moved into `presence.spec`'s away test, which made the rest of its checks.

Gallery (24 runs):
- The dark runs of `narrow-geometry` (18), `home-write-geometry` (4) and `attachment-images` (2): they measure boxes only, and the dark theme changes colours and shadows, never a size (`packages/tokens/src/themes.stylex.ts`).

Unit:
- `domain/status.test` "shows open topics in Recent", "brings a quiet topic back when it is marked unread", and two of the three checks of "hides quiet, resolved and unsubscribed": rows of the spec table in the same file. The resolved check stays.
- `domain/time.test` "is tabular-friendly": a regex weaker than the exact strings the table pins.
- `agent-contract/card-shape.test` "send status copy matches the fixed chat copy": `chat.test` checks 'Sent' and 'Failed' as text.
- `state/tabs-move.test` "the new order is saved and read back": `tabs-saved.test` saves a reordered strip.
- `fake-slack/control.test` "unknown frames reach the socket untouched": `slack/socket.test` sends the same frame and checks the same `raw`.
- `agent/activity.test`, the query plan check: it asked SQLite for the plan of SQL pasted into the test, not the query the app runs.
- `store/search.test`, the check of `ftsQuery`'s exact quoting: an internal string; the same test shows quoted input searches without an error.
- `engine/art.test`: "Redraw replaces a drawing" and "Undo after Redraw" are one test, with every check.

### 4.5 Rewritten to test behaviour

- `store/reader.test` "one transaction can write to both databases" passed for two separate transactions too; it now fails a transaction after both writes and checks neither database kept its value.
- `slack/api.test` "a 429 on one method pauses only that method" read the queue's private `pausedUntil` map; it now shows a second call to the method failing fast without reaching Slack while another method works.
- `state/tabs-saved.test` pinned every key of the tab object; it now checks the old flag is gone and the tab reads back unpinned.
- `richtext/emoji.test` repeated the quick reaction list from the source; it now checks every listed name draws an emoji.
- `richtext/rendering.test` "flattens every inline including list items" had no list in its input.
- `desktop topic.spec` "every control in the header answers hover and press" skipped a control that was missing; a missing control now fails.

### 4.6 Looked at and left

- `specs:check` with no cache is the longest step of the side lane (287 to 435 s: 266 simulations two at a time, 19 Apalache checks one at a time). It is kept as it is. Two options for the owner, not taken: run it in its own lane, or let `verify:main` reuse cached Apalache results, which are deterministic for the same inputs, and rerun only the random simulations.
- The engine's `quiet()` (a 300 ms window with no new fake calls) is called about 100 times; a count of calls in flight could replace it, but every engine test depends on it.
- `realtime.spec`'s offline tests take 8 to 10 s each, waiting for the socket to come back; finding the backoff was not worth the few seconds.
- The crash and recovery unit tests start the agent from source two to four times per test. A shared Node compile cache cut their CPU by about 30%; wall time did not change, since the runs are one after another.
- The agent's AI and Juno e2e specs, `idle-cpu`, `quick-start` and the named regression tests: kept as they are.

## 5. Results

### 5.1 The full plan

`verify:main`'s plan on one 8x16 machine, main at `76f87e74` against this branch (`.remote/20261018T084528-23224-d74a06e6` and `.remote/20261018T091927-58463-9d73c00d` in the branch's worktree):

| Step | Main | Branch |
| --- | --- | --- |
| `test` | 215 s | 179 s |
| `specs:check`, no cache | 287 s | 423 s (unchanged; it ran beside the desktop e2e here, and alone on main while the gallery hung) |
| `test:gallery` | 933 s, failed (the hang) | 248 s, passed |
| `test:desktop` | 313 s, passed | 330 s, 1 failed: the relaunch flash test, unchanged here and failing on main too (section 2) |
| Script time | 1,246 s | 603 s |

The whole run is twice as fast, almost all of it from the hang. Per-step times in this plan depend on which steps overlap: on main the desktop e2e ran alone after the side lane had finished, on the branch beside the Quint check at 42% CPU pressure, so its tests ran slower each.

### 5.2 Each suite alone

To compare the suites themselves, both refs ran every step one after another (`JUNO_PLAN_SERIAL=1`, `test`, `test:gallery`, `test:desktop`, one 8x16 machine each, back to back). The base is main with only the hang fix, so the gallery's other changes are measured on their own; the Quint check is left out, since nothing here changes it.

| Suite | Base: script time, summed, tests | Branch: script time, summed, tests | Script time saved |
| --- | --- | --- | --- |
| `test` | 125 s, 380 s in timed files, 1,688 | 87 s, 337 s, 1,681 | 38 s (30%) |
| `test:gallery` | 164 s, 3,145 s, 305 | 157 s, 3,256 s, 281 | 7 s (4%) |
| `test:desktop` | 282 s, 1,843 s, 474 | 261 s, 1,658 s, 408 | 21 s (7%) |
| Total | 571 s | 505 s | 66 s (12%) |

Plus 791 s in every full run on main from the gallery hang, and a gallery run that failed every time.

Where it came from:

- Unit: `slack-schedule` 53 to 28 s, `automated` 22 to 6 s; the rest is noise within a few seconds.
- Desktop: the largest drops are `layout-shift` 57 to 38 s, `presence` 42 to 30 s, `juno-agent/schedule` 36 to 25 s, `juno-agent/t3` 39 to 29 s, `topic` 34 to 25 s, `message-actions` 34 to 26 s, `notifications` 29 to 22 s, `palette` 35 to 28 s, `tabs` 35 to 29 s: the merges, at about 2 s per launch saved, and the waits on saved values.
- Gallery: `narrow-geometry` 53 to 31 s, `trigger-open` 20 to 9 s, `home-write-geometry` 14 to 10 s. The shift walk is unchanged within noise (median part 112 s before, 118 s after, at the same load), so skipping endless animations in `openState` did not show; the walk's own touches dominate it. Its 24 parts finish together, so the gallery's script time follows the walk, and the gallery gained little in script time.

The desktop suite's time is now about half setup (section 1.2), spread over fewer tests. What is left to gain there is in the specs that need a fresh app or a relaunch per test (`juno-agent/crash`, `realtime`, `quick-start`, `presence`), each kept for that reason.

## 6. Mutation check

Ten behaviours, each broken in the code (not committed), run against the slimmer suite on one remote machine. Every break was caught; each failure names the broken behaviour.

| # | Behaviour broken | Caught by |
| --- | --- | --- |
| 1 | Juno does not write Slack's schedule when Slack already holds the hours (`slackSchedule.ts`: always write) | `engine/slack-schedule.test` "writes nothing when Slack already holds the hours" |
| 2 | A channel the user took out of Automated stays out (`automatedView.ts`: no `you` verdict on removal) | `engine/automated.test` "never moves back a channel the user took out" |
| 3 | A drawing the model failed is not asked again (`art/job.ts`: failed rows are due) | `engine/art.test` "…does not ask again" (37 calls, 35 expected), the check that slept before |
| 4 | A resolved topic leaves the sidebar (`domain/status.ts`: resolved placed in Recent) | `domain/status.test` "hides a resolved topic", the check kept from the removed test |
| 5 | A 429 pauses only its own method (`queue.ts`: a pause on one method pauses all) | `slack/api.test` "a 429 on one method pauses only that method", as rewritten |
| 6 | Rename from the topic header saves the title (`header.tsx`: save does nothing) | `actions.spec` "Rename from a row …, from the header …", which took over from the removed `topic.spec` test |
| 7 | The account menu offers Set yourself active when away (`AccountMenu.tsx`: always "away") | `presence.spec`, both tests, with the checks moved from `notifications.spec` |
| 8 | Pinned tabs survive a restart (`tabs.ts`: saved unpinned) | `navigation.spec` "…pins survive a restart" (now polls `user.db`) and `state/tabs-saved.test` |
| 9 | A chosen accent survives a relaunch (`main/index.ts`: accent not written) | `theme.spec`, the merged theme and accent test, at its step "…survives a relaunch: after the relaunch" |
| 10 | A secondary button does not move on hover (`Button.tsx`: 1 px margin on hover) | `gallery/shift.spec`, the walk's parts and the Topic art tests that hover one |

One break first tried for row 1, a zero debounce, changed nothing: two quick changes to the hours still made one write, so it was not a test of the suite and was replaced.
